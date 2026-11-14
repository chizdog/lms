import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, isLearnerOnly } from '../middleware/rbac';
import { uploadFor, commitUpload, discardUpload, resolveStoredPath, materialTypeForExt } from '../middleware/upload';
import { asyncHandler, recordAudit } from '../utils/http';
import { badRequest, forbidden, notFound } from '../utils/errors';

export const materialsRouter = Router();
materialsRouter.use(requireAuth);

const lessonParam = z.object({ lessonId: z.coerce.number().int().positive() });

materialsRouter.post(
  '/lessons/:lessonId/materials',
  requirePermission('material.upload'),
  csrfProtection,
  validate(lessonParam, 'params'),
  uploadFor('document'),
  asyncHandler(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const file = req.file;
    if (!file) throw badRequest('Attach a file in the "file" field');
    const lesson = await queryOne('SELECT id FROM lessons WHERE id = ?', [lessonId]);
    if (!lesson) { discardUpload(file.path); throw notFound('Lesson not found'); }

    // Videos use the video bucket; everything else lands in documents.
    const ext = path.extname(file.originalname).toLowerCase();
    const kind = ['.mp4', '.webm'].includes(ext) ? 'video' : 'document';
    let committed;
    try {
      committed = commitUpload(file.path, kind);
    } catch (error) {
      discardUpload(file.path);
      throw error;
    }

    const id = await execute(
      `INSERT INTO learning_materials (lesson_id, original_name, stored_name, file_path, mime_type, file_size, material_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [lessonId, file.originalname, committed.storedName, committed.relativePath, file.mimetype, committed.size, materialTypeForExt(ext), req.auth!.userId],
    ).then((r) => r.insertId);

    recordAudit(req, { action: 'material.uploaded', entityType: 'learning_material', entityId: id, description: `Uploaded ${file.originalname} to lesson ${lessonId}` });
    res.status(201).json({ id, filePath: committed.relativePath, size: committed.size });
  }),
);

// Video uploads are large; accept them through the same endpoint with the video bucket.
materialsRouter.post(
  '/lessons/:lessonId/video',
  requirePermission('material.upload'),
  csrfProtection,
  validate(lessonParam, 'params'),
  uploadFor('video'),
  asyncHandler(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const file = req.file;
    if (!file) throw badRequest('Attach a video in the "file" field');
    const lesson = await queryOne('SELECT id FROM lessons WHERE id = ?', [lessonId]);
    if (!lesson) { discardUpload(file.path); throw notFound('Lesson not found'); }

    let committed;
    try {
      committed = commitUpload(file.path, 'video');
    } catch (error) {
      discardUpload(file.path);
      throw error;
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const id = await execute(
      `INSERT INTO learning_materials (lesson_id, original_name, stored_name, file_path, mime_type, file_size, material_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, 'video', ?)`,
      [lessonId, file.originalname, committed.storedName, committed.relativePath, file.mimetype, committed.size, req.auth!.userId],
    ).then((r) => r.insertId);
    await execute("UPDATE lessons SET content_type = 'video' WHERE id = ?", [lessonId]);
    recordAudit(req, { action: 'material.uploaded', entityType: 'learning_material', entityId: id, description: `Uploaded video ${file.originalname} to lesson ${lessonId}` });
    res.status(201).json({ id, filePath: committed.relativePath, size: committed.size });
  }),
);

materialsRouter.get(
  '/materials/:id/download',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const material = await queryOne<RowDataPacket & { file_path: string; original_name: string; mime_type: string; course_id: number }>(
      `SELECT lm.file_path, lm.original_name, lm.mime_type, m.course_id
       FROM learning_materials lm
       JOIN lessons l ON l.id = lm.lesson_id
       JOIN course_modules m ON m.id = l.module_id
       WHERE lm.id = ?`,
      [id],
    );
    if (!material) throw notFound('Material not found');

    if (isLearnerOnly(auth)) {
      const enrolled = await queryOne('SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?', [material.course_id, auth.employee.id]);
      if (!enrolled) throw forbidden('Enroll in the course to access its materials');
    }

    const absolute = resolveStoredPath(material.file_path);
    if (!fs.existsSync(absolute)) throw notFound('File missing from storage');
    res.setHeader('Content-Type', material.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${material.original_name.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(absolute).pipe(res);
  }),
);

materialsRouter.delete(
  '/materials/:id',
  requirePermission('material.delete'),
  csrfProtection,
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const material = await queryOne<RowDataPacket & { file_path: string }>('SELECT file_path FROM learning_materials WHERE id = ?', [id]);
    if (!material) throw notFound('Material not found');
    await execute('DELETE FROM learning_materials WHERE id = ?', [id]);
    const absolute = resolveStoredPath(material.file_path);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    recordAudit(req, { action: 'material.deleted', entityType: 'learning_material', entityId: id, description: `Deleted material ${id}` });
    res.json({ success: true });
  }),
);

materialsRouter.get(
  '/lessons/:lessonId/materials',
  validate(lessonParam, 'params'),
  asyncHandler(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const rows = await query(
      'SELECT id, original_name, mime_type, file_size, material_type, created_at FROM learning_materials WHERE lesson_id = ? ORDER BY id',
      [lessonId],
    );
    res.json({ items: rows.map((r) => ({ id: r.id, originalName: r.original_name, mimeType: r.mime_type, fileSize: Number(r.file_size), materialType: r.material_type, createdAt: r.created_at })) });
  }),
);