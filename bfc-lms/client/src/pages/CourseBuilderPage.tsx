import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, Image as ImageIcon, Video, FileText, Link2, Type, Presentation,
  Upload, Globe, Archive, Eye, GripVertical,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseDetail, Category, Department, ContentType, Material, CourseModule } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { fileSize, titleCase } from '@/lib/format';
import { DIFFICULTY_LABELS, STATUS_TONES } from '@/lib/access';
import {
  PageHeader, Card, Button, Badge, LoadingBlock, Modal, Field, Input, Textarea, Select, ConfirmDialog, IconButton,
} from '@/components/ui';
import { CourseThumb } from '@/components/media';

const CONTENT_TYPES: { value: ContentType; label: string; icon: typeof Video }[] = [
  { value: 'text', label: 'Text / Article', icon: Type },
  { value: 'video', label: 'Video', icon: Video },
  { value: 'pdf', label: 'PDF', icon: FileText },
  { value: 'presentation', label: 'Presentation', icon: Presentation },
  { value: 'document', label: 'Document', icon: FileText },
  { value: 'image', label: 'Image', icon: ImageIcon },
  { value: 'link', label: 'External link', icon: Link2 },
];
export function contentIcon(t: string) { return CONTENT_TYPES.find((c) => c.value === t)?.icon ?? FileText; }

interface CourseForm {
  code: string; title: string; description: string; categoryId: string; departmentId: string; instructorName: string;
  durationMinutes: number; difficulty: string; courseType: string; targetAudience: string; certificateEnabled: boolean; signatoryName: string;
}
const EMPTY: CourseForm = {
  code: '', title: '', description: '', categoryId: '', departmentId: '', instructorName: '',
  durationMinutes: 0, difficulty: 'beginner', courseType: 'optional', targetAudience: '', certificateEnabled: true, signatoryName: '',
};

export function CourseBuilderPage() {
  const { id } = useParams();
  const courseId = id ? Number(id) : null;
  const isNew = courseId === null;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { has } = useAuth();
  const canPublish = has('course.publish');
  const canManageLessons = has('lesson.manage');

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: Category[] }>('/courses/categories') });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') });
  const { data: course, isLoading } = useQuery({ queryKey: ['course', courseId], queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`), enabled: !isNew });

  const [form, setForm] = useState<CourseForm>(EMPTY);
  useEffect(() => {
    if (course) setForm({
      code: course.code, title: course.title, description: course.description ?? '', categoryId: String(course.categoryId),
      departmentId: course.departmentId ? String(course.departmentId) : '', instructorName: course.instructorName ?? '',
      durationMinutes: course.durationMinutes, difficulty: course.difficulty, courseType: course.courseType,
      targetAudience: course.targetAudience ?? '', certificateEnabled: course.certificateEnabled, signatoryName: course.signatoryName ?? '',
    });
  }, [course]);

  const saveCourse = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code, title: form.title, description: form.description || null, categoryId: Number(form.categoryId),
        departmentId: form.departmentId ? Number(form.departmentId) : null, instructorName: form.instructorName || null,
        durationMinutes: form.durationMinutes, difficulty: form.difficulty, courseType: form.courseType,
        targetAudience: form.targetAudience || null, certificateEnabled: form.certificateEnabled, signatoryName: form.signatoryName || null,
      };
      return isNew ? api.post<{ id: number }>('/courses/', body) : api.put(`/courses/${courseId}`, body);
    },
    onSuccess: (res) => {
      toast.success(isNew ? 'Course created — now add your curriculum' : 'Course saved');
      void qc.invalidateQueries({ queryKey: ['courses'] });
      if (isNew) navigate(`/courses/${(res as { id: number }).id}/edit`, { replace: true });
      else void qc.invalidateQueries({ queryKey: ['course', courseId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: (status: string) => api.post(`/courses/${courseId}/publish`, { status }),
    onSuccess: (_d, status) => { toast.success(`Course ${status === 'published' ? 'published' : status === 'archived' ? 'archived' : 'set to draft'}`); void qc.invalidateQueries({ queryKey: ['course', courseId] }); void qc.invalidateQueries({ queryKey: ['courses'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadThumb = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.upload(`/courses/${courseId}/thumbnail`, fd); },
    onSuccess: () => { toast.success('Thumbnail updated'); void qc.invalidateQueries({ queryKey: ['course', courseId] }); void qc.invalidateQueries({ queryKey: ['courses'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = form.code.trim() && form.title.trim() && form.categoryId;

  if (!isNew && isLoading) return <LoadingBlock label="Loading course…" />;

  return (
    <div>
      <div className="mb-4">
        <Link to="/courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> Back to courses</Link>
      </div>
      <PageHeader title={isNew ? 'Create course' : `Edit: ${course?.title ?? ''}`}
        subtitle={isNew ? 'Start with the course details, then build the curriculum.' : course?.code}
        actions={<>
          {!isNew && <Link to={`/courses/${courseId}`}><Button variant="outline" icon={<Eye className="h-4 w-4" />}>Preview</Button></Link>}
          <Button variant="gold" icon={<Save className="h-4 w-4" />} loading={saveCourse.isPending} disabled={!valid} onClick={() => saveCourse.mutate()}>{isNew ? 'Create course' : 'Save details'}</Button>
        </>} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h3 className="mb-4 font-bold text-ink-900">Course details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Course code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ESP-101" maxLength={30} className="font-mono" /></Field>
              <Field label="Category" required><Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Select category</option>{(cats?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select></Field>
              <div className="sm:col-span-2"><Field label="Title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} placeholder="Espresso Preparation" /></Field></div>
              <div className="sm:col-span-2"><Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} className="min-h-[120px]" /></Field></div>
              <Field label="Instructor"><Input value={form.instructorName} onChange={(e) => setForm({ ...form, instructorName: e.target.value })} maxLength={150} /></Field>
              <Field label="Department" hint="Leave empty for a shared catalogue course."><Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">All departments</option>{(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select></Field>
              <Field label="Difficulty"><Select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select></Field>
              <Field label="Course type"><Select value={form.courseType} onChange={(e) => setForm({ ...form, courseType: e.target.value })}>
                <option value="optional">Optional (self-enroll)</option><option value="mandatory">Mandatory (assigned)</option>
              </Select></Field>
              <Field label="Duration (minutes)"><Input type="number" min={0} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} /></Field>
              <Field label="Target audience"><Input value={form.targetAudience} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })} maxLength={255} placeholder="All baristas" /></Field>
              <div className="sm:col-span-2"><Field label="Certificate signatory" hint="Name printed on completion certificates."><Input value={form.signatoryName} onChange={(e) => setForm({ ...form, signatoryName: e.target.value })} maxLength={150} placeholder="Maria Santos, L&D Manager" /></Field></div>
              <label className="flex items-center gap-2.5 text-sm text-ink-700 sm:col-span-2">
                <input type="checkbox" checked={form.certificateEnabled} onChange={(e) => setForm({ ...form, certificateEnabled: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
                Issue a certificate on completion
              </label>
            </div>
          </Card>

          {!isNew && canManageLessons && course && <Curriculum courseId={courseId!} modules={course.modules} />}
          {!isNew && !canManageLessons && <Card className="p-5 text-sm text-ink-500">You have read-only access to this course’s curriculum.</Card>}
        </div>

        <div className="space-y-6">
          {!isNew && course && (
            <>
              <Card className="p-5">
                <h3 className="mb-3 font-bold text-ink-900">Status</h3>
                <Badge tone={STATUS_TONES[course.status]}>{titleCase(course.status)}</Badge>
                <div className="mt-3 space-y-2 text-xs text-ink-500">
                  <p>{course.moduleCount} modules · {course.lessonCount} lessons</p>
                  {course.publishedAt && <p>Published {course.publishedAt.slice(0, 10)}</p>}
                </div>
                {canPublish && (
                  <div className="mt-4 space-y-2">
                    {course.status !== 'published' && <Button variant="gold" size="sm" className="w-full" icon={<Globe className="h-4 w-4" />} loading={publish.isPending} onClick={() => publish.mutate('published')}>Publish course</Button>}
                    {course.status === 'published' && <Button variant="outline" size="sm" className="w-full" icon={<Archive className="h-4 w-4" />} loading={publish.isPending} onClick={() => publish.mutate('archived')}>Archive</Button>}
                    {course.status === 'archived' && <Button variant="outline" size="sm" className="w-full" loading={publish.isPending} onClick={() => publish.mutate('draft')}>Move to draft</Button>}
                    <p className="text-[11px] text-ink-400">Publishing requires at least one lesson and notifies all staff.</p>
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <h3 className="mb-3 font-bold text-ink-900">Thumbnail</h3>
                <CourseThumb courseId={courseId} title={course.title} className="h-40 w-full" />
                {has('course.update') && (
                  <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-600 hover:border-gold-300 hover:text-gold-700">
                    <ImageIcon className="h-4 w-4" /> {uploadThumb.isPending ? 'Uploading…' : 'Upload image'}
                    <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" disabled={uploadThumb.isPending}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadThumb.mutate(f); e.target.value = ''; }} />
                  </label>
                )}
                <p className="mt-2 text-[11px] text-ink-400">PNG, JPG or WebP. Auto-cropped to 960×540.</p>
              </Card>
            </>
          )}
          {isNew && <Card className="p-5 text-sm text-ink-500"><p className="font-semibold text-ink-700">Next steps</p><p className="mt-2">After creating the course you can upload a thumbnail, build modules and lessons, attach materials, add assessments and publish.</p></Card>}
        </div>
      </div>
    </div>
  );
}

function Curriculum({ courseId, modules }: { courseId: number; modules: CourseModule[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [moduleModal, setModuleModal] = useState<{ mode: 'create' | 'edit'; module?: CourseModule } | null>(null);
  const [lessonModal, setLessonModal] = useState<{ moduleId: number; lesson?: CourseModule['lessons'][number] } | null>(null);
  const [materialLesson, setMaterialLesson] = useState<{ id: number; title: string } | null>(null);
  const [delModule, setDelModule] = useState<CourseModule | null>(null);
  const [delLesson, setDelLesson] = useState<{ id: number; title: string } | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['course', courseId] });

  const removeModule = useMutation({ mutationFn: (id: number) => api.del(`/courses/modules/${id}`), onSuccess: () => { toast.success('Module deleted'); setDelModule(null); invalidate(); }, onError: (e: Error) => { toast.error(e.message); setDelModule(null); } });
  const removeLesson = useMutation({ mutationFn: (id: number) => api.del(`/courses/lessons/${id}`), onSuccess: () => { toast.success('Lesson deleted'); setDelLesson(null); invalidate(); }, onError: (e: Error) => { toast.error(e.message); setDelLesson(null); } });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold text-ink-900">Curriculum</h3>
        <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModuleModal({ mode: 'create' })}>Add module</Button>
      </div>
      {modules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-400">No modules yet. Add a module to start organizing lessons.</p>
      ) : (
        <div className="space-y-4">
          {modules.map((m, mi) => (
            <div key={m.id} className="rounded-xl border border-ink-100">
              <div className="flex items-center gap-2 border-b border-ink-100 bg-ink-50/50 px-4 py-3">
                <GripVertical className="h-4 w-4 text-ink-300" />
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-100 text-xs font-bold text-gold-700">{mi + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-800">{m.title}</p>
                  {m.description && <p className="truncate text-xs text-ink-400">{m.description}</p>}
                </div>
                <IconButton label="Edit module" onClick={() => setModuleModal({ mode: 'edit', module: m })}><Pencil className="h-4 w-4" /></IconButton>
                <IconButton label="Delete module" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDelModule(m)}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
              <div className="divide-y divide-ink-50">
                {m.lessons.length === 0 ? <p className="px-4 py-3 text-xs text-ink-400">No lessons in this module.</p> : m.lessons.map((l) => {
                  const Icon = contentIcon(l.contentType);
                  return (
                    <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500"><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-800">{l.title}</p>
                        <p className="text-[11px] text-ink-400">{titleCase(l.contentType)} · {l.durationMinutes} min{l.isRequired ? ' · Required' : ''}{l.materialCount > 0 ? ` · ${l.materialCount} file${l.materialCount === 1 ? '' : 's'}` : ''}</p>
                      </div>
                      <IconButton label="Materials" onClick={() => setMaterialLesson({ id: l.id, title: l.title })}><Upload className="h-4 w-4" /></IconButton>
                      <IconButton label="Edit lesson" onClick={() => setLessonModal({ moduleId: m.id, lesson: l })}><Pencil className="h-4 w-4" /></IconButton>
                      <IconButton label="Delete lesson" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDelLesson({ id: l.id, title: l.title })}><Trash2 className="h-4 w-4" /></IconButton>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-2.5">
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLessonModal({ moduleId: m.id })}>Add lesson</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {moduleModal && <ModuleModal courseId={courseId} state={moduleModal} onClose={() => setModuleModal(null)} onSaved={invalidate} nextOrder={modules.length} />}
      {lessonModal && <LessonModal state={lessonModal} onClose={() => setLessonModal(null)} onSaved={invalidate} />}
      {materialLesson && <MaterialModal lesson={materialLesson} onClose={() => setMaterialLesson(null)} onChanged={invalidate} />}

      <ConfirmDialog open={!!delModule} onClose={() => setDelModule(null)} onConfirm={() => delModule && removeModule.mutate(delModule.id)}
        title="Delete module" message={`Delete "${delModule?.title}" and all its lessons and materials? This cannot be undone.`} confirmLabel="Delete" danger loading={removeModule.isPending} />
      <ConfirmDialog open={!!delLesson} onClose={() => setDelLesson(null)} onConfirm={() => delLesson && removeLesson.mutate(delLesson.id)}
        title="Delete lesson" message={`Delete "${delLesson?.title}"?`} confirmLabel="Delete" danger loading={removeLesson.isPending} />
    </Card>
  );
}

function ModuleModal({ courseId, state, onClose, onSaved, nextOrder }: { courseId: number; state: { mode: 'create' | 'edit'; module?: CourseModule }; onClose: () => void; onSaved: () => void; nextOrder: number }) {
  const toast = useToast();
  const [title, setTitle] = useState(state.module?.title ?? '');
  const [description, setDescription] = useState(state.module?.description ?? '');
  const [sortOrder, setSortOrder] = useState(state.module?.sortOrder ?? nextOrder);
  const save = useMutation({
    mutationFn: () => {
      const body = { title, description: description || null, sortOrder };
      return state.mode === 'edit' ? api.put(`/courses/modules/${state.module!.id}`, body) : api.post(`/courses/${courseId}/modules`, body);
    },
    onSuccess: () => { toast.success(state.mode === 'edit' ? 'Module updated' : 'Module added'); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title={state.mode === 'edit' ? 'Edit module' : 'Add module'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="gold" loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Module 1 — Foundations" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></Field>
        <Field label="Sort order"><Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
}

function LessonModal({ state, onClose, onSaved }: { state: { moduleId: number; lesson?: CourseModule['lessons'][number] }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = state.lesson;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [contentType, setContentType] = useState<ContentType>(editing?.contentType ?? 'text');
  const [content, setContent] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(editing?.durationMinutes ?? 0);
  const [isRequired, setIsRequired] = useState(editing?.isRequired ?? true);
  const [sortOrder, setSortOrder] = useState(editing?.sortOrder ?? 0);

  const save = useMutation({
    mutationFn: () => {
      const body = { title, contentType, content: content || null, externalUrl: externalUrl || null, durationMinutes, isRequired, sortOrder };
      return editing ? api.put(`/courses/lessons/${editing.id}`, body) : api.post(`/courses/modules/${state.moduleId}/lessons`, body);
    },
    onSuccess: () => { toast.success(editing ? 'Lesson updated' : 'Lesson added'); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const isFile = ['video', 'pdf', 'presentation', 'document', 'image'].includes(contentType);
  const valid = title.trim() && (contentType !== 'link' || externalUrl.trim());

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit lesson' : 'Add lesson'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="gold" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Save lesson</Button></>}>
      <div className="space-y-4">
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Pulling the perfect shot" /></Field>
        <Field label="Content type" required>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONTENT_TYPES.map((t) => { const Icon = t.icon; return (
              <button key={t.value} type="button" onClick={() => setContentType(t.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition ${contentType === t.value ? 'border-gold-400 bg-gold-50 text-gold-700' : 'border-ink-100 text-ink-500 hover:border-ink-200'}`}>
                <Icon className="h-5 w-5" />{t.label}
              </button>
            ); })}
          </div>
        </Field>
        {contentType === 'link' && <Field label="External URL" required><Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" maxLength={500} /></Field>}
        {contentType === 'text' && <Field label="Content" hint="Article text shown to learners."><Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[160px]" maxLength={50000} /></Field>}
        {isFile && <p className="rounded-xl bg-sky-50 px-3 py-2.5 text-xs text-sky-700">After saving, use the <strong>Materials</strong> button on this lesson to upload the {contentType === 'video' ? 'video (MP4/WebM)' : 'file (PDF/PPT/Word)'}.</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration (minutes)"><Input type="number" min={0} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} /></Field>
          <Field label="Sort order"><Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} /></Field>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-ink-700">
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
          Required lesson (counts toward completion)
        </label>
      </div>
    </Modal>
  );
}

function MaterialModal({ lesson, onClose, onChanged }: { lesson: { id: number; title: string }; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { has } = useAuth();
  const canDelete = has('material.delete');
  const { data, isLoading } = useQuery({ queryKey: ['materials', lesson.id], queryFn: () => api.get<{ items: Material[] }>(`/lessons/${lesson.id}/materials`) });

  const uploadDoc = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.upload(`/lessons/${lesson.id}/materials`, fd); },
    onSuccess: () => { toast.success('File uploaded'); void qc.invalidateQueries({ queryKey: ['materials', lesson.id] }); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const uploadVideo = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.upload(`/lessons/${lesson.id}/video`, fd); },
    onSuccess: () => { toast.success('Video uploaded'); void qc.invalidateQueries({ queryKey: ['materials', lesson.id] }); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/materials/${id}`),
    onSuccess: () => { toast.success('Material removed'); void qc.invalidateQueries({ queryKey: ['materials', lesson.id] }); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  return (
    <Modal open onClose={onClose} title="Lesson materials" subtitle={lesson.title} size="lg"
      footer={<Button variant="outline" onClick={onClose}>Done</Button>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 px-4 py-3 text-sm font-semibold text-ink-600 hover:border-gold-300 hover:text-gold-700">
          <FileText className="h-4 w-4" /> {uploadDoc.isPending ? 'Uploading…' : 'Upload document'}
          <input type="file" accept=".pdf,.ppt,.pptx,.doc,.docx" className="hidden" disabled={uploadDoc.isPending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc.mutate(f); e.target.value = ''; }} />
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 px-4 py-3 text-sm font-semibold text-ink-600 hover:border-gold-300 hover:text-gold-700">
          <Video className="h-4 w-4" /> {uploadVideo.isPending ? 'Uploading…' : 'Upload video'}
          <input type="file" accept=".mp4,.webm" className="hidden" disabled={uploadVideo.isPending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVideo.mutate(f); e.target.value = ''; }} />
        </label>
      </div>
      <p className="mb-3 text-[11px] text-ink-400">Documents: PDF, PPT, PPTX, DOC, DOCX. Videos: MP4, WebM. Files are verified and stored securely.</p>
      {isLoading ? <LoadingBlock /> : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-400">No materials attached yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-500"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-800">{m.originalName}</p><p className="text-[11px] text-ink-400">{titleCase(m.materialType)} · {fileSize(m.fileSize)}</p></div>
              {canDelete && <IconButton label="Remove" className="hover:bg-red-50 hover:text-red-600" onClick={() => remove.mutate(m.id)}><Trash2 className="h-4 w-4" /></IconButton>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}