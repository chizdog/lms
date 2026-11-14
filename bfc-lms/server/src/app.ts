import path from 'node:path';
import fs from 'node:fs';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth';
import { employeesRouter } from './modules/employees';
import { organizationRouter } from './modules/organization';
import { usersRouter } from './modules/users';
import { coursesRouter } from './modules/courses';
import { materialsRouter } from './modules/materials';
import { learningRouter } from './modules/learning';
import { quizzesRouter } from './modules/quizzes';
import { enrollmentsRouter } from './modules/enrollments';
import { dashboardRouter } from './modules/dashboard';
import { notificationsRouter } from './modules/notifications';
import { certificatesRouter } from './modules/certificates';
import { reportsRouter } from './modules/reports';
import { systemRouter } from './modules/system';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'blob:'],
          objectSrc: ["'self'", 'blob:'],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.clientOrigin.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
    }),
  );

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 5000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'bfc-lms-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/courses', coursesRouter);
  app.use('/api/learning', learningRouter);
  app.use('/api/quizzes', quizzesRouter);
  app.use('/api/enrollments', enrollmentsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/certificates', certificatesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/system', systemRouter);
  // Broad mounts last: organization exposes /departments and /branches; materials
  // exposes /lessons/:id/materials and /materials/:id under the /api root.
  app.use('/api', organizationRouter);
  app.use('/api', materialsRouter);

  // Built SPA (production). In development Vite serves the client on its own port.
  const clientDist = path.join(env.projectRoot, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}