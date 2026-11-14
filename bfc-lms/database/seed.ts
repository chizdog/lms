import fs from 'node:fs';
import path from 'node:path';
import { pool as dbPool, toPg, RowDataPacket, ExecuteResult } from '../server/src/config/db';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_PERMISSIONS, ROLE_CODES } from '../server/src/config/permissions';
import { hashPassword } from '../server/src/utils/password';
import { writeCertificatePdf } from '../server/src/utils/certificate-pdf';
import { makeTrainingPdf, makeDiagramPng, makeDocx, makePptx } from './sample-assets';

const serverRoot = path.resolve(__dirname, '../server');
dotenv.config({ path: path.join(serverRoot, '.env') });

const storageDir = path.resolve(serverRoot, process.env.STORAGE_DIR ?? '../storage');
const uploadsDir = path.join(storageDir, 'uploads');
const assetsDir = path.join(__dirname, 'assets');

const DEMO_PASSWORD = 'Bfc@2026';

// Deterministic RNG so repeated seeds produce the same demo dataset.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261111);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));

const pool = {
  async execute<R = any>(sql: string, params: unknown[] = []): Promise<[R, any[]]> {
    let text = toPg(sql);
    if (/^\s*SELECT/i.test(text)) {
      const r = await dbPool.query(text, params as any[]);
      return [r.rows as R, []];
    }
    if (/^\s*INSERT/i.test(text) && !/\bRETURNING\b/i.test(text)) text += ' RETURNING *';
    const r = await dbPool.query(text, params as any[]);
    return [{ insertId: Number(r.rows?.[0]?.id ?? 0), affectedRows: r.rowCount ?? 0 } as R, []];
  },
  async query<R = any>(sql: string, params: unknown[] = []): Promise<[R, any[]]> {
    const r = await dbPool.query(toPg(sql), params as any[]);
    return [r.rows as R, []];
  },
  async end(): Promise<void> {
    await dbPool.end();
  },
};

async function insert(table: string, data: object): Promise<number> {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const [result] = await pool.execute<ExecuteResult>(sql, Object.values(data));
  return result.insertId;
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Object.values(rows[0])[0] as T;
}

const now = () => dayjs().format('YYYY-MM-DD HH:mm:ss');
const dateStr = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const DEPARTMENTS = [
  { code: 'OPS', name: 'Operations', description: 'Store operations, baristas and shift leadership.' },
  { code: 'HR', name: 'Human Resources', description: 'People operations, recruitment and employee relations.' },
  { code: 'LD', name: 'Learning & Development', description: 'Training design, delivery and certification.' },
  { code: 'IT', name: 'Information Technology', description: 'Systems, POS infrastructure and digital tools.' },
  { code: 'FIN', name: 'Finance', description: 'Accounting, payroll and financial control.' },
  { code: 'MKT', name: 'Marketing', description: 'Brand, promotions and customer experience.' },
  { code: 'SCM', name: 'Supply Chain', description: 'Procurement, logistics and inventory.' },
  { code: 'QA', name: 'Quality Assurance', description: 'Food safety audits and product quality.' },
];

const BRANCHES = [
  { code: 'HQ', name: 'Head Office', city: 'Taguig', region: 'NCR', address: 'Bonifacio Global City' },
  { code: 'BGC', name: 'BGC High Street', city: 'Taguig', region: 'NCR', address: 'High Street, BGC' },
  { code: 'MAK', name: 'Makati Ayala', city: 'Makati', region: 'NCR', address: 'Ayala Avenue' },
  { code: 'QC', name: 'Vertis North', city: 'Quezon City', region: 'NCR', address: 'Vertis North Mall' },
  { code: 'ORT', name: 'Ortigas Center', city: 'Pasig', region: 'NCR', address: 'Ortigas Center' },
  { code: 'ALA', name: 'Alabang Town Center', city: 'Muntinlupa', region: 'NCR', address: 'Alabang-Zapote Road' },
  { code: 'CEB', name: 'Cebu IT Park', city: 'Cebu City', region: 'Visayas', address: 'Cebu IT Park' },
  { code: 'DAV', name: 'Abreeza Davao', city: 'Davao City', region: 'Mindanao', address: 'Abreeza Mall' },
];

const CATEGORIES = [
  { name: 'Barista Training', slug: 'barista-training', color: '#C8952F', description: 'Core barista craft and beverage execution.' },
  { name: 'Coffee Preparation', slug: 'coffee-preparation', color: '#8C6A24', description: 'Espresso, milk and signature drink preparation.' },
  { name: 'Customer Service Excellence', slug: 'customer-service', color: '#B0762A', description: 'Guest experience and service recovery.' },
  { name: 'Food Safety and Sanitation', slug: 'food-safety', color: '#4F7A4F', description: 'Hygiene, sanitation and food handling compliance.' },
  { name: 'Store Operations', slug: 'store-operations', color: '#5B6472', description: 'Opening, closing, cash and inventory routines.' },
  { name: 'Product Knowledge', slug: 'product-knowledge', color: '#A65E2E', description: 'Menu, ingredients and seasonal offerings.' },
  { name: 'Management and Leadership', slug: 'management-leadership', color: '#3E4A5B', description: 'Shift leadership and people management.' },
  { name: 'HR and Employee Orientation', slug: 'hr-orientation', color: '#7A5C8C', description: 'Onboarding and employee lifecycle.' },
  { name: 'IT Systems and Digital Tools', slug: 'it-systems', color: '#2F6F7A', description: 'POS, scheduling and internal digital tools.' },
  { name: 'Company Policies and Compliance', slug: 'policies-compliance', color: '#8C3A3A', description: 'Code of conduct and mandatory compliance.' },
];

interface LessonSeed {
  title: string;
  type: 'video' | 'pdf' | 'presentation' | 'document' | 'image' | 'text' | 'link';
  minutes: number;
  content?: string;
  url?: string;
  asset?: 'pdf' | 'png' | 'mp4' | 'docx' | 'pptx';
}

interface CourseSeed {
  code: string;
  title: string;
  category: string;
  department: string | null;
  thumbnail: string;
  instructor: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  type: 'mandatory' | 'optional';
  audience: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  modules: { title: string; lessons: LessonSeed[] }[];
  quiz: {
    title: string;
    passing: number;
    timeLimit: number | null;
    maxAttempts: number;
    randomize: boolean;
    questions: {
      type: 'multiple_choice' | 'true_false' | 'multiple_select' | 'identification' | 'short_answer';
      text: string;
      points: number;
      options?: { text: string; correct: boolean }[];
      answer?: string;
      explanation?: string;
    }[];
  };
}

const COURSES: CourseSeed[] = [
  {
    code: 'BFC-ESP-101',
    title: 'Espresso Preparation',
    category: 'Coffee Preparation',
    department: 'OPS',
    thumbnail: 'course-espresso.jpg',
    instructor: 'Carlo Mendoza',
    difficulty: 'beginner',
    type: 'mandatory',
    audience: 'Baristas, Senior Baristas, Shift Supervisors',
    description:
      'Master the BFC espresso standard: dialing in the grinder, dosing and distribution, tamping pressure, extraction timing and sensory evaluation of a correct shot.',
    status: 'published',
    modules: [
      {
        title: 'Espresso Foundations',
        lessons: [
          { title: 'What Makes a Correct Espresso', type: 'text', minutes: 8, content: 'A correct BFC espresso is a 25-30 second extraction yielding 36g of liquid from an 18g dose. It shows a continuous mouse-tail stream, a hazelnut crema at least 3mm thick, and a balanced taste with sweetness forward and no harsh bitterness. Every shot outside this window must be discarded and re-pulled.' },
          { title: 'Anatomy of the Espresso Machine', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'Grinder Dial-In Reference Card', type: 'pdf', minutes: 6, asset: 'pdf' },
        ],
      },
      {
        title: 'Execution & Quality Control',
        lessons: [
          { title: 'Dosing, Distribution and Tamping', type: 'video', minutes: 14, asset: 'mp4' },
          { title: 'Extraction Timing Workflow', type: 'image', minutes: 5, asset: 'png' },
          { title: 'Sensory Evaluation and Shot Rejection', type: 'text', minutes: 10, content: 'Taste every third shot during a rush. Reject shots that are sour (under-extracted), ashy or dry (over-extracted), or that show channeling spurts. Log rejected shots on the waste sheet so the shift supervisor can adjust the grind.' },
          { title: 'Espresso Standard Operating Procedure', type: 'document', minutes: 8, asset: 'docx' },
        ],
      },
    ],
    quiz: {
      title: 'Espresso Preparation Certification Exam',
      passing: 80,
      timeLimit: 15,
      maxAttempts: 3,
      randomize: true,
      questions: [
        { type: 'multiple_choice', text: 'What is the BFC standard espresso yield from an 18g dose?', points: 2, options: [{ text: '18g', correct: false }, { text: '36g', correct: true }, { text: '50g', correct: false }, { text: '60g', correct: false }], explanation: 'BFC uses a 1:2 brew ratio: 18g in, 36g out.' },
        { type: 'multiple_choice', text: 'Which extraction time window meets the BFC standard?', points: 2, options: [{ text: '10-15 seconds', correct: false }, { text: '25-30 seconds', correct: true }, { text: '40-45 seconds', correct: false }, { text: '60 seconds', correct: false }] },
        { type: 'true_false', text: 'A shot with visible channeling spurts may still be served if it tastes acceptable.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }], explanation: 'Channeling means uneven extraction; the shot must be rejected.' },
        { type: 'multiple_select', text: 'Which are signs of an over-extracted espresso? (Select all that apply)', points: 3, options: [{ text: 'Ashy, dry finish', correct: true }, { text: 'Harsh bitterness', correct: true }, { text: 'Bright sourness', correct: false }, { text: 'Thin, pale crema', correct: true }] },
        { type: 'identification', text: 'Name the golden foam layer on top of a correctly extracted espresso.', points: 2, answer: 'crema', explanation: 'Crema indicates fresh coffee and proper pressure.' },
        { type: 'short_answer', text: 'In one or two sentences, explain what a barista should do when a shot extracts in 15 seconds.', points: 3, answer: 'reject|discard|re-pull|finer|adjust grind', explanation: 'Reject the shot and adjust the grind finer before re-pulling.' },
      ],
    },
  },
  {
    code: 'BFC-LAT-201',
    title: 'Latte Art Fundamentals',
    category: 'Barista Training',
    department: 'OPS',
    thumbnail: 'course-latte-art.jpg',
    instructor: 'Carlo Mendoza',
    difficulty: 'intermediate',
    type: 'optional',
    audience: 'Baristas and Senior Baristas',
    description:
      'Develop controlled milk steaming and free-pour technique to produce the BFC signature rosetta and heart patterns consistently.',
    status: 'published',
    modules: [
      {
        title: 'Milk Science',
        lessons: [
          { title: 'Steaming Milk to Microfoam', type: 'video', minutes: 15, asset: 'mp4' },
          { title: 'Milk Temperature and Texture Standards', type: 'text', minutes: 8, content: 'Steam whole milk to 60-65C. Above 70C the proteins denature and the foam collapses; below 55C the drink feels lukewarm. Target glossy microfoam with no visible bubbles, resembling wet paint.' },
          { title: 'Milk Steaming Troubleshooting Guide', type: 'pdf', minutes: 6, asset: 'pdf' },
        ],
      },
      {
        title: 'Free-Pour Technique',
        lessons: [
          { title: 'The Heart Pattern', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'The Rosetta Pattern', type: 'video', minutes: 14, asset: 'mp4' },
          { title: 'Pour Height and Flow Diagram', type: 'image', minutes: 5, asset: 'png' },
        ],
      },
    ],
    quiz: {
      title: 'Latte Art Skills Assessment',
      passing: 75,
      timeLimit: 12,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'What is the target steaming temperature for whole milk at BFC?', points: 2, options: [{ text: '45-50C', correct: false }, { text: '60-65C', correct: true }, { text: '75-80C', correct: false }, { text: '90C', correct: false }] },
        { type: 'true_false', text: 'Visible large bubbles are acceptable in BFC microfoam.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'multiple_select', text: 'Which factors affect latte art symmetry? (Select all that apply)', points: 3, options: [{ text: 'Pour height', correct: true }, { text: 'Milk texture', correct: true }, { text: 'Cup tilt angle', correct: true }, { text: 'Cup color', correct: false }] },
        { type: 'identification', text: 'Name the leaf-like latte art pattern taught in this course.', points: 2, answer: 'rosetta|rosette' },
        { type: 'short_answer', text: 'Describe how you would fix milk that has been steamed above 70C.', points: 3, answer: 'discard|re-steam|new milk|start over', explanation: 'Overheated milk cannot be recovered; discard and re-steam fresh milk.' },
      ],
    },
  },
  {
    code: 'BFC-MAT-102',
    title: 'Matcha Preparation',
    category: 'Coffee Preparation',
    department: 'OPS',
    thumbnail: 'course-matcha.jpg',
    instructor: 'Maria Santos',
    difficulty: 'beginner',
    type: 'optional',
    audience: 'Baristas and Kitchen Crew',
    description: 'Prepare the BFC iced and hot matcha latte to standard, including powder dosing, whisking and layering.',
    status: 'published',
    modules: [
      {
        title: 'Matcha Basics',
        lessons: [
          { title: 'Matcha Grades and Storage', type: 'text', minutes: 7, content: 'BFC uses ceremonial-grade matcha for hot drinks and culinary-grade for blended beverages. Store opened tins sealed, refrigerated, and away from light. Use within 30 days of opening.' },
          { title: 'Whisking Technique', type: 'video', minutes: 10, asset: 'mp4' },
          { title: 'Matcha Dosing Chart', type: 'pdf', minutes: 5, asset: 'pdf' },
        ],
      },
      {
        title: 'Building the Drink',
        lessons: [
          { title: 'Iced Matcha Latte Layering', type: 'video', minutes: 9, asset: 'mp4' },
          { title: 'Quality Checklist', type: 'image', minutes: 4, asset: 'png' },
        ],
      },
    ],
    quiz: {
      title: 'Matcha Preparation Check',
      passing: 75,
      timeLimit: 10,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'How long may an opened matcha tin be used?', points: 2, options: [{ text: '7 days', correct: false }, { text: '30 days', correct: true }, { text: '90 days', correct: false }, { text: '1 year', correct: false }] },
        { type: 'true_false', text: 'Matcha should be stored in direct sunlight to keep it dry.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'multiple_select', text: 'Which are correct matcha handling practices? (Select all that apply)', points: 3, options: [{ text: 'Seal the tin after use', correct: true }, { text: 'Refrigerate opened tins', correct: true }, { text: 'Sift before whisking', correct: true }, { text: 'Leave the whisk soaking overnight', correct: false }] },
        { type: 'identification', text: 'Name the bamboo tool used to whisk matcha.', points: 2, answer: 'chasen|whisk' },
      ],
    },
  },
  {
    code: 'BFC-SPL-103',
    title: 'Spanish Latte Preparation',
    category: 'Coffee Preparation',
    department: 'OPS',
    thumbnail: 'course-espresso.jpg',
    instructor: 'Carlo Mendoza',
    difficulty: 'beginner',
    type: 'optional',
    audience: 'Baristas',
    description: 'Build the BFC Spanish Latte with the correct condensed milk ratio, espresso base and milk texture.',
    status: 'published',
    modules: [
      {
        title: 'Recipe Standard',
        lessons: [
          { title: 'Spanish Latte Recipe Card', type: 'pdf', minutes: 6, asset: 'pdf' },
          { title: 'Condensed Milk Dosing and Mixing', type: 'video', minutes: 8, asset: 'mp4' },
          { title: 'Common Recipe Deviations', type: 'text', minutes: 6, content: 'The most common deviations are under-dosing condensed milk (drink tastes flat) and adding it after the milk (poor integration). Always dissolve condensed milk into the hot espresso first, then pour steamed milk.' },
        ],
      },
    ],
    quiz: {
      title: 'Spanish Latte Recipe Check',
      passing: 80,
      timeLimit: 8,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'When should condensed milk be added for a Spanish Latte?', points: 2, options: [{ text: 'Into the hot espresso first', correct: true }, { text: 'After the steamed milk', correct: false }, { text: 'On top of the foam', correct: false }, { text: 'It is not used', correct: false }] },
        { type: 'true_false', text: 'A Spanish Latte uses the same espresso base as a standard latte.', points: 1, options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] },
        { type: 'identification', text: 'Name the sweetened dairy ingredient that defines a Spanish Latte.', points: 2, answer: 'condensed milk|condensed' },
      ],
    },
  },
  {
    code: 'BFC-CSE-110',
    title: 'Customer Service Excellence',
    category: 'Customer Service Excellence',
    department: 'OPS',
    thumbnail: 'course-customer-service.jpg',
    instructor: 'Maria Santos',
    difficulty: 'beginner',
    type: 'mandatory',
    audience: 'All customer-facing staff',
    description: 'Deliver the BFC guest experience: greeting standards, order accuracy, service recovery and handling difficult situations.',
    status: 'published',
    modules: [
      {
        title: 'The BFC Guest Experience',
        lessons: [
          { title: 'Greeting and Farewell Standards', type: 'text', minutes: 8, content: 'Greet every guest within 5 seconds of entering the counter zone with eye contact and a smile. Use the guest\'s name when known. Close every interaction with a genuine farewell, never a scripted mumble.' },
          { title: 'Service Recovery in Practice', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'Service Recovery Playbook', type: 'pdf', minutes: 7, asset: 'pdf' },
        ],
      },
      {
        title: 'Handling Difficult Situations',
        lessons: [
          { title: 'The LAST Model', type: 'presentation', minutes: 10, asset: 'pptx' },
          { title: 'Escalation Matrix', type: 'image', minutes: 5, asset: 'png' },
          { title: 'External Reference: Service Quality Principles', type: 'link', minutes: 6, url: 'https://sca.coffee/' },
        ],
      },
    ],
    quiz: {
      title: 'Customer Service Excellence Exam',
      passing: 80,
      timeLimit: 15,
      maxAttempts: 3,
      randomize: true,
      questions: [
        { type: 'multiple_choice', text: 'Within how many seconds must a guest be greeted at the counter zone?', points: 2, options: [{ text: '5 seconds', correct: true }, { text: '30 seconds', correct: false }, { text: '2 minutes', correct: false }, { text: 'Only when they speak first', correct: false }] },
        { type: 'multiple_select', text: 'Which steps belong to the LAST service recovery model? (Select all that apply)', points: 3, options: [{ text: 'Listen', correct: true }, { text: 'Apologize', correct: true }, { text: 'Solve', correct: true }, { text: 'Thank', correct: true }] },
        { type: 'true_false', text: 'A complaint should be argued with the guest until they accept the store policy.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'identification', text: 'What is the first step of the LAST model?', points: 2, answer: 'listen' },
        { type: 'short_answer', text: 'A guest received the wrong drink. Describe your first two actions.', points: 3, answer: 'apologize|listen|remake|replace|sorry', explanation: 'Listen and apologize, then remake the correct drink immediately.' },
      ],
    },
  },
  {
    code: 'BFC-FSS-120',
    title: 'Food Safety and Sanitation',
    category: 'Food Safety and Sanitation',
    department: 'QA',
    thumbnail: 'course-food-safety.jpg',
    instructor: 'Carlo Mendoza',
    difficulty: 'beginner',
    type: 'mandatory',
    audience: 'All store employees',
    description: 'Mandatory compliance training on personal hygiene, cross-contamination control, cleaning schedules and temperature danger zones.',
    status: 'published',
    modules: [
      {
        title: 'Hygiene Fundamentals',
        lessons: [
          { title: 'Personal Hygiene and Handwashing', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'The Temperature Danger Zone', type: 'text', minutes: 8, content: 'The temperature danger zone is 5C to 60C. Perishable items must not remain in this zone for more than 2 hours cumulative. Milk, cream and cooked items must be refrigerated at or below 4C immediately after use.' },
          { title: 'Handwashing Procedure Poster', type: 'image', minutes: 4, asset: 'png' },
        ],
      },
      {
        title: 'Sanitation Program',
        lessons: [
          { title: 'Cleaning and Sanitizing Schedule', type: 'pdf', minutes: 8, asset: 'pdf' },
          { title: 'Cross-Contamination Control', type: 'presentation', minutes: 10, asset: 'pptx' },
          { title: 'External Reference: WHO Food Safety', type: 'link', minutes: 8, url: 'https://www.who.int/health-topics/food-safety' },
        ],
      },
    ],
    quiz: {
      title: 'Food Safety Compliance Exam',
      passing: 85,
      timeLimit: 20,
      maxAttempts: 2,
      randomize: true,
      questions: [
        { type: 'multiple_choice', text: 'What is the temperature danger zone?', points: 2, options: [{ text: '0C to 4C', correct: false }, { text: '5C to 60C', correct: true }, { text: '60C to 100C', correct: false }, { text: '-18C to 0C', correct: false }] },
        { type: 'multiple_choice', text: 'Maximum cumulative time perishables may stay in the danger zone?', points: 2, options: [{ text: '30 minutes', correct: false }, { text: '2 hours', correct: true }, { text: '6 hours', correct: false }, { text: '12 hours', correct: false }] },
        { type: 'true_false', text: 'Handwashing is required after handling cash and before handling food.', points: 1, options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] },
        { type: 'multiple_select', text: 'Which prevent cross-contamination? (Select all that apply)', points: 3, options: [{ text: 'Separate cutting boards', correct: true }, { text: 'Color-coded cloths', correct: true }, { text: 'Storing raw above ready-to-eat', correct: false }, { text: 'Sanitizing contact surfaces', correct: true }] },
        { type: 'identification', text: 'Name the maximum refrigeration temperature for milk at BFC (number only, in Celsius).', points: 2, answer: '4' },
        { type: 'short_answer', text: 'Why must cleaning and sanitizing be treated as two separate steps?', points: 3, answer: 'clean removes|sanitiz kills|soil|dirt|germs|bacteria', explanation: 'Cleaning removes soil; sanitizing reduces microorganisms. Sanitizer cannot work through soil.' },
      ],
    },
  },
  {
    code: 'BFC-POS-130',
    title: 'POS System Training',
    category: 'IT Systems and Digital Tools',
    department: 'IT',
    thumbnail: 'course-pos-operations.jpg',
    instructor: 'Alex Reyes',
    difficulty: 'beginner',
    type: 'mandatory',
    audience: 'Cashiers, Baristas, Shift Supervisors',
    description: 'Operate the BFC point-of-sale: order entry, modifiers, payments, refunds, offline mode and end-of-day reconciliation.',
    status: 'published',
    modules: [
      {
        title: 'Daily POS Operations',
        lessons: [
          { title: 'Order Entry and Modifiers', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'Payments, Voids and Refunds', type: 'text', minutes: 9, content: 'Voids require supervisor approval before settlement; refunds require a receipt and manager PIN. Never process a refund to a different payment method than the original tender.' },
          { title: 'POS Quick Reference', type: 'pdf', minutes: 6, asset: 'pdf' },
        ],
      },
      {
        title: 'Exceptions and Closing',
        lessons: [
          { title: 'Offline Mode and Sync Recovery', type: 'document', minutes: 8, asset: 'docx' },
          { title: 'End-of-Day Reconciliation', type: 'presentation', minutes: 10, asset: 'pptx' },
        ],
      },
    ],
    quiz: {
      title: 'POS Operations Certification',
      passing: 80,
      timeLimit: 15,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'Who must approve a void before settlement?', points: 2, options: [{ text: 'Any barista', correct: false }, { text: 'Shift supervisor', correct: true }, { text: 'The guest', correct: false }, { text: 'No approval needed', correct: false }] },
        { type: 'true_false', text: 'A refund may be issued to a different payment method than the original tender.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'multiple_select', text: 'Which are part of end-of-day reconciliation? (Select all that apply)', points: 3, options: [{ text: 'Count the drawer', correct: true }, { text: 'Compare Z-report to tender totals', correct: true }, { text: 'Log variances', correct: true }, { text: 'Delete transaction history', correct: false }] },
        { type: 'identification', text: 'Name the POS mode used when the internet connection drops.', points: 2, answer: 'offline|offline mode' },
      ],
    },
  },
  {
    code: 'BFC-ONB-140',
    title: 'Employee Onboarding',
    category: 'HR and Employee Orientation',
    department: 'HR',
    thumbnail: 'course-customer-service.jpg',
    instructor: 'Jose Ramirez',
    difficulty: 'beginner',
    type: 'mandatory',
    audience: 'All new hires',
    description: 'Welcome to But First, Coffee. Employment basics, benefits, attendance, pay cycle and where to get help.',
    status: 'published',
    modules: [
      {
        title: 'Welcome to BFC',
        lessons: [
          { title: 'Your First Week Checklist', type: 'pdf', minutes: 7, asset: 'pdf' },
          { title: 'Attendance, Leave and Pay Cycle', type: 'text', minutes: 9, content: 'BFC pays semi-monthly on the 15th and the last working day. Log attendance through the HR portal before each shift. Leave requests need 7 days notice except emergencies, which must be reported to the shift supervisor before shift start.' },
          { title: 'Benefits Overview', type: 'presentation', minutes: 10, asset: 'pptx' },
        ],
      },
      {
        title: 'Getting Help',
        lessons: [
          { title: 'Who to Ask: Support Directory', type: 'image', minutes: 4, asset: 'png' },
          { title: 'HR Portal Walkthrough', type: 'video', minutes: 8, asset: 'mp4' },
        ],
      },
    ],
    quiz: {
      title: 'Onboarding Knowledge Check',
      passing: 70,
      timeLimit: 10,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'How often does BFC pay salaries?', points: 2, options: [{ text: 'Weekly', correct: false }, { text: 'Semi-monthly', correct: true }, { text: 'Monthly', correct: false }, { text: 'Quarterly', correct: false }] },
        { type: 'true_false', text: 'Emergency leave must be reported to the shift supervisor before shift start.', points: 1, options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] },
        { type: 'identification', text: 'How many days notice is required for a normal leave request (number only)?', points: 2, answer: '7' },
      ],
    },
  },
  {
    code: 'BFC-CUL-150',
    title: 'BFC Company Culture and Core Values',
    category: 'Company Policies and Compliance',
    department: 'HR',
    thumbnail: 'course-latte-art.jpg',
    instructor: 'Jose Ramirez',
    difficulty: 'beginner',
    type: 'mandatory',
    audience: 'All employees',
    description: 'The BFC story, our five core values, code of conduct and the behaviors we recognize and reward.',
    status: 'published',
    modules: [
      {
        title: 'Who We Are',
        lessons: [
          { title: 'The BFC Story', type: 'text', minutes: 8, content: 'But First, Coffee began with a single cart and a belief that great coffee should pause a busy day. Our five core values are: Craft in Every Cup, Warmth Without Script, Own the Moment, Clean as You Go, and Grow Together.' },
          { title: 'Core Values in Action', type: 'video', minutes: 10, asset: 'mp4' },
          { title: 'Code of Conduct Handbook', type: 'pdf', minutes: 10, asset: 'pdf' },
        ],
      },
    ],
    quiz: {
      title: 'Culture and Conduct Check',
      passing: 75,
      timeLimit: 10,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_select', text: 'Which are BFC core values? (Select all that apply)', points: 3, options: [{ text: 'Craft in Every Cup', correct: true }, { text: 'Warmth Without Script', correct: true }, { text: 'Own the Moment', correct: true }, { text: 'Speed Over Quality', correct: false }] },
        { type: 'true_false', text: 'Clean as You Go means cleaning only at closing time.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'identification', text: 'Complete the value: "Craft in Every ____".', points: 2, answer: 'cup' },
      ],
    },
  },
  {
    code: 'BFC-OPS-210',
    title: 'Store Operations Essentials',
    category: 'Store Operations',
    department: 'OPS',
    thumbnail: 'course-pos-operations.jpg',
    instructor: 'Carlo Mendoza',
    difficulty: 'intermediate',
    type: 'optional',
    audience: 'Shift Supervisors and Store Managers',
    description: 'Opening and closing routines, cash control, inventory counts, waste logging and shift handover discipline.',
    status: 'published',
    modules: [
      {
        title: 'Shift Routines',
        lessons: [
          { title: 'Opening Checklist', type: 'pdf', minutes: 8, asset: 'pdf' },
          { title: 'Closing and Cash Control', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'Shift Handover Standard', type: 'text', minutes: 7, content: 'A handover is complete only when the incoming supervisor has walked the floor, verified the drawer, reviewed open issues and signed the handover log. Verbal handovers alone are not acceptable.' },
        ],
      },
      {
        title: 'Inventory and Waste',
        lessons: [
          { title: 'Weekly Inventory Count', type: 'presentation', minutes: 10, asset: 'pptx' },
          { title: 'Waste Logging Rules', type: 'document', minutes: 6, asset: 'docx' },
        ],
      },
    ],
    quiz: {
      title: 'Store Operations Assessment',
      passing: 75,
      timeLimit: 15,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'When is a shift handover considered complete?', points: 2, options: [{ text: 'When verbally described', correct: false }, { text: 'When the incoming supervisor signs the log after verification', correct: true }, { text: 'At shift end automatically', correct: false }, { text: 'When the drawer is counted by anyone', correct: false }] },
        { type: 'true_false', text: 'Waste may be logged at the end of the week from memory.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'multiple_select', text: 'Which belong to the opening checklist? (Select all that apply)', points: 3, options: [{ text: 'Verify refrigerator temperatures', correct: true }, { text: 'Count the opening drawer', correct: true }, { text: 'Check sanitizer concentration', correct: true }, { text: 'Process refunds', correct: false }] },
        { type: 'short_answer', text: 'Why must waste be logged at the moment it happens?', points: 3, answer: 'accuracy|trace|real|inventory|variance|audit', explanation: 'Immediate logging keeps inventory variance traceable and auditable.' },
      ],
    },
  },
  {
    code: 'BFC-LDR-310',
    title: 'Shift Leadership for Supervisors',
    category: 'Management and Leadership',
    department: 'OPS',
    thumbnail: 'course-customer-service.jpg',
    instructor: 'Maria Santos',
    difficulty: 'advanced',
    type: 'optional',
    audience: 'Shift Supervisors, Assistant Store Managers, Store Managers',
    description: 'Lead a shift under pressure: deployment planning, coaching in the moment, conflict handling and performance conversations.',
    status: 'published',
    modules: [
      {
        title: 'Leading the Shift',
        lessons: [
          { title: 'Deployment and Positioning', type: 'text', minutes: 10, content: 'Deploy by bottleneck, not by headcount. During peak, the bar position is the constraint; protect it with a dedicated support role. Re-evaluate positioning every 30 minutes as the queue shape changes.' },
          { title: 'Coaching in the Moment', type: 'video', minutes: 12, asset: 'mp4' },
          { title: 'Performance Conversation Framework', type: 'pdf', minutes: 9, asset: 'pdf' },
        ],
      },
      {
        title: 'Difficult Conversations',
        lessons: [
          { title: 'Conflict De-escalation', type: 'presentation', minutes: 11, asset: 'pptx' },
          { title: 'Case Studies', type: 'document', minutes: 8, asset: 'docx' },
        ],
      },
    ],
    quiz: {
      title: 'Shift Leadership Assessment',
      passing: 80,
      timeLimit: 20,
      maxAttempts: 2,
      randomize: true,
      questions: [
        { type: 'multiple_choice', text: 'During peak, deployment should be driven by what?', points: 2, options: [{ text: 'Headcount', correct: false }, { text: 'The current bottleneck', correct: true }, { text: 'Seniority', correct: false }, { text: 'Personal preference', correct: false }] },
        { type: 'true_false', text: 'Coaching in the moment should publicly correct an employee to set an example.', points: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }] },
        { type: 'multiple_select', text: 'Which are elements of a performance conversation? (Select all that apply)', points: 3, options: [{ text: 'Specific observed behavior', correct: true }, { text: 'Impact on the team', correct: true }, { text: 'Agreed next step', correct: true }, { text: 'Comparison to other staff', correct: false }] },
        { type: 'short_answer', text: 'How often should a supervisor re-evaluate positioning during peak?', points: 3, answer: '30|thirty|every 30 minutes', explanation: 'Every 30 minutes, as the queue shape changes.' },
      ],
    },
  },
  {
    code: 'BFC-PRD-160',
    title: 'Product Knowledge: Seasonal Menu',
    category: 'Product Knowledge',
    department: 'MKT',
    thumbnail: 'course-matcha.jpg',
    instructor: 'Maria Santos',
    difficulty: 'beginner',
    type: 'optional',
    audience: 'All customer-facing staff',
    description: 'Know the current seasonal menu: ingredients, allergens, tasting notes and how to recommend confidently.',
    status: 'draft',
    modules: [
      {
        title: 'Seasonal Lineup',
        lessons: [
          { title: 'Seasonal Drink Lineup and Tasting Notes', type: 'pdf', minutes: 8, asset: 'pdf' },
          { title: 'Allergen Matrix', type: 'image', minutes: 5, asset: 'png' },
          { title: 'Recommendation Scripts', type: 'text', minutes: 6, content: 'Recommend by preference, not by price. Ask "Do you prefer something bright and fruity, or rich and creamy?" then match to one seasonal drink and describe it in one sentence.' },
        ],
      },
    ],
    quiz: {
      title: 'Seasonal Menu Knowledge Check',
      passing: 70,
      timeLimit: 10,
      maxAttempts: 3,
      randomize: false,
      questions: [
        { type: 'multiple_choice', text: 'How should a barista choose a recommendation?', points: 2, options: [{ text: 'By highest price', correct: false }, { text: 'By guest preference', correct: true }, { text: 'By what is easiest to make', correct: false }, { text: 'Randomly', correct: false }] },
        { type: 'true_false', text: 'Allergen information must be confirmed from the allergen matrix, not memory.', points: 1, options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] },
        { type: 'identification', text: 'Name the document that lists allergens for every menu item.', points: 2, answer: 'allergen matrix|matrix' },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
interface EmployeeSeed {
  no: string;
  first: string;
  last: string;
  dept: string;
  branch: string;
  position: string;
  status: 'regular' | 'probationary' | 'contractual' | 'intern';
  username?: string;
  email?: string;
  role?: string;
}

const DEMO_EMPLOYEES: EmployeeSeed[] = [
  { no: 'BFC-0001', first: 'Alex', last: 'Reyes', dept: 'IT', branch: 'HQ', position: 'IT Systems Administrator', status: 'regular', username: 'superadmin', email: 'admin@butfirstcoffee.com', role: ROLE_CODES.SUPER_ADMIN },
  { no: 'BFC-0002', first: 'Maria', last: 'Santos', dept: 'LD', branch: 'HQ', position: 'L&D Manager', status: 'regular', username: 'ld.admin', email: 'ld@butfirstcoffee.com', role: ROLE_CODES.LD_ADMIN },
  { no: 'BFC-0003', first: 'Jose', last: 'Ramirez', dept: 'HR', branch: 'HQ', position: 'HR Manager', status: 'regular', username: 'hr.admin', email: 'hr@butfirstcoffee.com', role: ROLE_CODES.HR_ADMIN },
  { no: 'BFC-0004', first: 'Carlo', last: 'Mendoza', dept: 'OPS', branch: 'HQ', position: 'Regional Training Supervisor', status: 'regular', username: 'dept.admin', email: 'trainer@butfirstcoffee.com', role: ROLE_CODES.DEPT_ADMIN },
  { no: 'BFC-0005', first: 'Juan', last: 'Dela Cruz', dept: 'OPS', branch: 'BGC', position: 'Barista', status: 'regular', username: 'employee', email: 'juan.delacruz@butfirstcoffee.com', role: ROLE_CODES.EMPLOYEE },
];

const FIRST_NAMES = ['Andrea', 'Miguel', 'Patricia', 'Rafael', 'Camille', 'Enrico', 'Bianca', 'Paolo', 'Kristine', 'Marco', 'Angela', 'Diego', 'Sofia', 'Luis', 'Trisha', 'Gabriel', 'Nicole', 'Anton', 'Rica', 'Emmanuel', 'Danica', 'Victor', 'Hannah', 'Oscar', 'Liza', 'Ramon', 'Celine', 'Ivan', 'Mae', 'Felix'];
const LAST_NAMES = ['Bautista', 'Villanueva', 'Aquino', 'Castillo', 'Domingo', 'Espiritu', 'Fernandez', 'Gonzales', 'Hernandez', 'Ignacio', 'Javier', 'Lim', 'Manalo', 'Navarro', 'Ocampo', 'Pascual', 'Quinto', 'Rivera', 'Salazar', 'Tan', 'Uy', 'Valdez', 'Yap', 'Zamora', 'Co', 'Sy', 'Chua', 'Go', 'Ty', 'Kho'];
const STORE_POSITIONS = ['Barista', 'Senior Barista', 'Shift Supervisor', 'Store Manager', 'Assistant Store Manager', 'Cashier', 'Kitchen Crew'];
const OFFICE_POSITIONS: Record<string, string[]> = {
  HR: ['HR Officer', 'HR Specialist', 'Recruitment Officer'],
  LD: ['L&D Specialist', 'Training Coordinator'],
  IT: ['IT Support Specialist', 'Systems Analyst'],
  FIN: ['Accountant', 'Payroll Officer', 'Financial Analyst'],
  MKT: ['Marketing Coordinator', 'Brand Specialist'],
  SCM: ['Supply Chain Analyst', 'Procurement Officer', 'Logistics Coordinator'],
  QA: ['QA Officer', 'Food Safety Auditor'],
  OPS: ['Operations Analyst', 'Area Coordinator'],
};

function buildEmployees(): EmployeeSeed[] {
  const list: EmployeeSeed[] = [...DEMO_EMPLOYEES];
  let n = 6;
  const storeBranches = BRANCHES.filter((b) => b.code !== 'HQ');

  for (const branch of storeBranches) {
    const count = between(5, 7);
    for (let i = 0; i < count; i += 1) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      list.push({
        no: `BFC-${String(n).padStart(4, '0')}`,
        first,
        last,
        dept: 'OPS',
        branch: branch.code,
        position: i === 0 ? 'Store Manager' : i === 1 ? 'Shift Supervisor' : pick(STORE_POSITIONS),
        status: rand() < 0.15 ? 'probationary' : rand() < 0.08 ? 'contractual' : 'regular',
      });
      n += 1;
    }
  }

  for (const dept of Object.keys(OFFICE_POSITIONS)) {
    const count = between(2, 3);
    for (let i = 0; i < count; i += 1) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      list.push({
        no: `BFC-${String(n).padStart(4, '0')}`,
        first,
        last,
        dept,
        branch: 'HQ',
        position: pick(OFFICE_POSITIONS[dept]),
        status: rand() < 0.12 ? 'probationary' : 'regular',
      });
      n += 1;
    }
  }

  return list;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('[seed] clearing existing data ...');
  const tables = ['audit_logs', 'notifications', 'certificates', 'quiz_answers', 'quiz_attempts', 'quiz_options', 'quiz_questions', 'quizzes', 'lesson_progress', 'course_enrollments', 'learning_materials', 'lessons', 'course_modules', 'courses', 'course_categories', 'sessions', 'department_admins', 'users', 'employees', 'branches', 'departments', 'role_permissions', 'permissions', 'roles', 'system_settings'];
  await pool.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);

  // --- Course thumbnails ---------------------------------------------------
  // The optimised JPGs ship in database/assets/thumbnails so a fresh clone
  // (e.g. Render) provisions them without relying on the gitignored storage/.
  const thumbSrc = path.join(assetsDir, 'thumbnails');
  const thumbDest = path.join(uploadsDir, 'thumbnails');
  if (fs.existsSync(thumbSrc)) {
    fs.mkdirSync(thumbDest, { recursive: true });
    for (const file of fs.readdirSync(thumbSrc).filter((f) => f.endsWith('.jpg'))) {
      const target = path.join(thumbDest, file);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(thumbSrc, file), target);
    }
  }

  // --- Roles & permissions -------------------------------------------------
  console.log('[seed] roles and permissions ...');
  const roleIds: Record<string, number> = {};
  for (const role of ROLE_DEFINITIONS) {
    roleIds[role.code] = await insert('roles', {
      code: role.code,
      name: role.name,
      description: role.description,
      is_system: 1,
    });
  }
  const permissionIds: Record<string, number> = {};
  for (const permission of PERMISSIONS) {
    permissionIds[permission.code] = await insert('permissions', permission);
  }
  for (const [roleCode, codes] of Object.entries(ROLE_PERMISSIONS)) {
    for (const code of codes) {
      await insert('role_permissions', { role_id: roleIds[roleCode], permission_id: permissionIds[code] });
    }
  }

  // --- Organization --------------------------------------------------------
  console.log('[seed] departments and branches ...');
  const deptIds: Record<string, number> = {};
  for (const dept of DEPARTMENTS) deptIds[dept.code] = await insert('departments', dept);
  const branchIds: Record<string, number> = {};
  for (const branch of BRANCHES) branchIds[branch.code] = await insert('branches', branch);

  // --- Employees & users ---------------------------------------------------
  console.log('[seed] employees and user accounts ...');
  const employees = buildEmployees();
  const { hash, salt } = await hashPassword(DEMO_PASSWORD);
  const employeeIds: Record<string, number> = {};
  const userIds: Record<string, number> = {};
  const employeeMeta: { id: number; no: string; dept: string; branch: string; position: string; name: string; role: string }[] = [];
  const usedEmails = new Set<string>();
  const usedUsernames = new Set<string>();

  const unique = (base: string, used: Set<string>): string => {
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  };

  for (const emp of employees) {
    const baseLocal = `${emp.first.toLowerCase()}.${emp.last.toLowerCase().replace(/\s+/g, '')}`;
    const localPart = unique(baseLocal, usedUsernames);
    const email = emp.email ?? `${localPart}@butfirstcoffee.com`;
    usedEmails.add(email);
    const username = emp.username ?? localPart;
    const employeeId = await insert('employees', {
      employee_no: emp.no,
      first_name: emp.first,
      last_name: emp.last,
      email,
      phone: `+63 9${between(10, 99)} ${between(100, 999)} ${between(1000, 9999)}`,
      department_id: deptIds[emp.dept],
      branch_id: branchIds[emp.branch],
      position: emp.position,
      employment_status: emp.status,
      hire_date: dateStr(dayjs().subtract(between(30, 1500), 'day')),
      is_active: 1,
    });
    employeeIds[emp.no] = employeeId;

    const roleCode = emp.role ?? ROLE_CODES.EMPLOYEE;
    const userId = await insert('users', {
      employee_id: employeeId,
      username,
      email,
      password_hash: hash,
      password_salt: salt,
      role_id: roleIds[roleCode],
      must_change_password: emp.role ? 0 : 1,
      is_active: 1,
      last_login_at: rand() < 0.7 ? now() : null,
    });
    userIds[emp.no] = userId;
    employeeMeta.push({ id: employeeId, no: emp.no, dept: emp.dept, branch: emp.branch, position: emp.position, name: `${emp.first} ${emp.last}`, role: roleCode });
  }

  // Department administrator scope: Operations + Quality Assurance.
  await insert('department_admins', { user_id: userIds['BFC-0004'], department_id: deptIds.OPS });
  await insert('department_admins', { user_id: userIds['BFC-0004'], department_id: deptIds.QA });

  await insert('system_settings', { setting_key: 'company_name', setting_value: 'But First, Coffee', description: 'Legal brand name used on certificates and reports.' });
  await insert('system_settings', { setting_key: 'certificate_signatory', setting_value: 'Maria Santos, L&D Manager', description: 'Default authorized signatory on certificates.' });
  await insert('system_settings', { setting_key: 'default_passing_score', setting_value: '75', description: 'Default assessment passing percentage.' });
  await insert('system_settings', { setting_key: 'reminder_days_before_due', setting_value: '3', description: 'Days before a deadline to send a reminder notification.' });
  await insert('system_settings', { setting_key: 'email_notifications_enabled', setting_value: 'false', description: 'Reserved for future email integration.' });

  // --- Shared material assets ---------------------------------------------
  console.log('[seed] generating learning material files ...');
  const videoSource = fs.readFileSync(path.join(assetsDir, 'sample-lesson.mp4'));

  const pdfBuffers: Record<string, Buffer> = {};
  for (const course of COURSES) {
    pdfBuffers[course.code] = await makeTrainingPdf({
      title: course.title,
      subtitle: `${course.code} · ${course.category} · Instructor: ${course.instructor}`,
      sections: course.modules.map((module) => ({
        heading: module.title,
        body: module.lessons
          .map((lesson) => `${lesson.title} (${lesson.minutes} min). ${lesson.content ?? 'Follow the guided lesson in the LMS and mark it complete when finished.'}`)
          .join(' '),
      })),
    });
  }
  const pngBuffer = makeDiagramPng({
    width: 1200,
    height: 675,
    title: 'BFC Workflow',
    steps: ['Prepare', 'Execute', 'Verify', 'Log'],
  });
  const docxBuffer = makeDocx('BFC Standard Operating Procedure', [
    'Purpose: define the repeatable standard for this task across all But First, Coffee branches.',
    'Scope: applies to all store employees and shift supervisors.',
    'Procedure: follow each step in order. Do not skip verification. Record deviations in the shift log.',
    'Responsibility: the shift supervisor owns compliance during the shift; the store manager owns weekly review.',
    'Records: completed checklists are retained for 12 months and reviewed during QA audits.',
  ]);
  const pptxBuffer = makePptx('BFC Training Deck', [
    { heading: 'Why This Matters', bullets: ['Consistency protects the brand', 'Every guest gets the same standard', 'Small deviations compound across branches'] },
    { heading: 'The Standard', bullets: ['Follow the documented sequence', 'Verify before serving', 'Log every deviation'] },
    { heading: 'Common Mistakes', bullets: ['Skipping verification under pressure', 'Relying on memory instead of the reference', 'Not logging waste or rejects'] },
    { heading: 'Your Commitment', bullets: ['Own the moment', 'Clean as you go', 'Ask when unsure'] },
  ]);

  const materialTypeFor = (asset: string): string =>
    asset === 'mp4' ? 'video' : asset === 'pdf' ? 'pdf' : asset === 'png' ? 'image' : asset === 'pptx' ? 'presentation' : 'document';
  const subdirFor = (asset: string): string =>
    asset === 'mp4' ? 'videos' : asset === 'png' ? 'images' : 'documents';
  const extFor = (asset: string): string => asset;
  const mimeFor = (asset: string): string =>
    asset === 'mp4' ? 'video/mp4' : asset === 'pdf' ? 'application/pdf' : asset === 'png' ? 'image/png' : asset === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  let materialCounter = 0;
  async function writeMaterial(lessonId: number, courseId: number, courseCode: string, lesson: LessonSeed, uploaderId: number): Promise<void> {
    if (!lesson.asset) return;
    materialCounter += 1;
    const storedName = `mat-${courseId}-${lessonId}-${materialCounter}.${extFor(lesson.asset)}`;
    const dir = path.join(uploadsDir, subdirFor(lesson.asset));
    fs.mkdirSync(dir, { recursive: true });
    const buffer =
      lesson.asset === 'mp4' ? videoSource
      : lesson.asset === 'pdf' ? pdfBuffers[courseCode]
      : lesson.asset === 'png' ? pngBuffer
      : lesson.asset === 'pptx' ? pptxBuffer
      : docxBuffer;
    fs.writeFileSync(path.join(dir, storedName), buffer);
    await insert('learning_materials', {
      lesson_id: lessonId,
      original_name: `${lesson.title.replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/\s+/g, '-')}.${extFor(lesson.asset)}`,
      stored_name: storedName,
      file_path: `uploads/${subdirFor(lesson.asset)}/${storedName}`,
      mime_type: mimeFor(lesson.asset),
      file_size: buffer.length,
      material_type: materialTypeFor(lesson.asset),
      uploaded_by: uploaderId,
    });
  }

  // --- Courses -------------------------------------------------------------
  console.log('[seed] courses, modules, lessons, materials ...');
  const categoryIds: Record<string, number> = {};
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const cat = CATEGORIES[i];
    categoryIds[cat.name] = await insert('course_categories', { ...cat, sort_order: i + 1, is_active: 1 });
  }

  const courseIds: Record<string, number> = {};
  const quizIds: Record<string, number> = {};
  const courseLessonIds: Record<string, number[]> = {};
  const ldUserId = userIds['BFC-0002'];

  for (const course of COURSES) {
    const totalMinutes = course.modules.reduce((sum, m) => sum + m.lessons.reduce((s, l) => s + l.minutes, 0), 0);
    const courseId = await insert('courses', {
      code: course.code,
      title: course.title,
      description: course.description,
      category_id: categoryIds[course.category],
      department_id: course.department ? deptIds[course.department] : null,
      thumbnail_path: `uploads/thumbnails/${course.thumbnail}`,
      instructor_name: course.instructor,
      duration_minutes: totalMinutes,
      difficulty: course.difficulty,
      course_type: course.type,
      target_audience: course.audience,
      status: course.status,
      certificate_enabled: 1,
      signatory_name: 'Maria Santos, L&D Manager',
      published_at: course.status === 'published' ? dayjs().subtract(between(20, 120), 'day').format('YYYY-MM-DD HH:mm:ss') : null,
      created_by: ldUserId,
    });
    courseIds[course.code] = courseId;
    courseLessonIds[course.code] = [];

    let moduleOrder = 0;
    for (const module of course.modules) {
      moduleOrder += 1;
      const moduleId = await insert('course_modules', {
        course_id: courseId,
        title: module.title,
        description: null,
        sort_order: moduleOrder,
      });
      let lessonOrder = 0;
      for (const lesson of module.lessons) {
        lessonOrder += 1;
        const lessonId = await insert('lessons', {
          module_id: moduleId,
          title: lesson.title,
          content_type: lesson.type,
          content: lesson.content ?? null,
          external_url: lesson.url ?? null,
          duration_minutes: lesson.minutes,
          sort_order: lessonOrder,
          is_required: 1,
        });
        courseLessonIds[course.code].push(lessonId);
        await writeMaterial(lessonId, courseId, course.code, lesson, ldUserId);
      }
    }

    // Quiz
    const quizId = await insert('quizzes', {
      course_id: courseId,
      title: course.quiz.title,
      description: `Assessment for ${course.title}. Passing score ${course.quiz.passing}%.`,
      passing_score: course.quiz.passing,
      time_limit_minutes: course.quiz.timeLimit,
      max_attempts: course.quiz.maxAttempts,
      randomize_questions: course.quiz.randomize ? 1 : 0,
      randomize_options: course.quiz.randomize ? 1 : 0,
      questions_per_attempt: null,
      show_results: 1,
      is_active: 1,
      created_by: ldUserId,
    });
    quizIds[course.code] = quizId;

    let questionOrder = 0;
    for (const question of course.quiz.questions) {
      questionOrder += 1;
      const questionId = await insert('quiz_questions', {
        quiz_id: quizId,
        question_type: question.type,
        question_text: question.text,
        points: question.points,
        correct_answer: question.answer ?? null,
        explanation: question.explanation ?? null,
        sort_order: questionOrder,
      });
      if (question.options) {
        let optionOrder = 0;
        for (const option of question.options) {
          optionOrder += 1;
          await insert('quiz_options', {
            question_id: questionId,
            option_text: option.text,
            is_correct: option.correct ? 1 : 0,
            sort_order: optionOrder,
          });
        }
      }
    }
  }

  // --- Enrollments, progress, attempts, certificates -----------------------
  console.log('[seed] enrollments, progress, attempts, certificates ...');
  const publishedCourses = COURSES.filter((c) => c.status === 'published');
  const mandatoryCodes = publishedCourses.filter((c) => c.type === 'mandatory').map((c) => c.code);

  const learners = employeeMeta.filter((e) => e.role === ROLE_CODES.EMPLOYEE || e.role === ROLE_CODES.DEPT_ADMIN);
  let certificateCounter = 0;
  let enrollmentCount = 0;
  let attemptCount = 0;

  for (const learner of learners) {
    // Mandatory courses relevant to the learner's department, plus a couple of optional ones.
    const assigned = new Set<string>();
    for (const code of mandatoryCodes) {
      const course = COURSES.find((c) => c.code === code)!;
      const relevant =
        course.department === null ||
        course.department === learner.dept ||
        (learner.dept === 'OPS' && ['OPS', 'QA', 'IT', 'HR'].includes(course.department ?? ''));
      if (relevant) assigned.add(code);
    }
    const optionalPool = publishedCourses.filter((c) => c.type === 'optional');
    const optionalCount = between(1, 3);
    for (let i = 0; i < optionalCount; i += 1) assigned.add(pick(optionalPool).code);

    for (const code of assigned) {
      const course = COURSES.find((c) => c.code === code)!;
      const courseId = courseIds[code];
      const lessonIds = courseLessonIds[code];
      const roll = rand();
      // 45% completed, 30% in progress, 15% assigned-not-started, 10% overdue-not-started
      const outcome = roll < 0.45 ? 'completed' : roll < 0.75 ? 'in_progress' : roll < 0.9 ? 'assigned' : 'overdue';

      const dueOffset = outcome === 'overdue' ? -between(3, 25) : between(5, 60);
      const dueDate = dateStr(dayjs().add(dueOffset, 'day'));
      const enrolledAt = dayjs().subtract(between(20, 90), 'day');

      let completedLessons = 0;
      if (outcome === 'completed') completedLessons = lessonIds.length;
      else if (outcome === 'in_progress') completedLessons = between(1, Math.max(1, lessonIds.length - 1));

      const progressPercent = Number(((completedLessons / lessonIds.length) * 100).toFixed(2));
      const status = outcome === 'completed' ? 'completed' : completedLessons > 0 ? 'in_progress' : 'assigned';
      const completedAt = outcome === 'completed' ? enrolledAt.add(between(3, 20), 'day') : null;

      const enrollmentId = await insert('course_enrollments', {
        course_id: courseId,
        employee_id: learner.id,
        assigned_by: ldUserId,
        assignment_type: course.type === 'mandatory' ? 'department' : 'individual',
        status,
        progress_percent: progressPercent,
        due_date: dueDate,
        enrolled_at: enrolledAt.format('YYYY-MM-DD HH:mm:ss'),
        started_at: completedLessons > 0 ? enrolledAt.add(1, 'day').format('YYYY-MM-DD HH:mm:ss') : null,
        completed_at: completedAt ? completedAt.format('YYYY-MM-DD HH:mm:ss') : null,
        last_accessed_at: completedLessons > 0 ? dayjs().subtract(between(0, 10), 'day').format('YYYY-MM-DD HH:mm:ss') : null,
      });
      enrollmentCount += 1;

      for (let i = 0; i < completedLessons; i += 1) {
        await insert('lesson_progress', {
          enrollment_id: enrollmentId,
          lesson_id: lessonIds[i],
          employee_id: learner.id,
          is_completed: 1,
          completed_at: enrolledAt.add(1 + i, 'day').format('YYYY-MM-DD HH:mm:ss'),
          time_spent_seconds: between(120, 900),
        });
      }

      // Assessment attempts
      const quizId = quizIds[code];
      const quizQuestions = await pool.execute<RowDataPacket[]>(
        'SELECT id, question_type, points, correct_answer FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order',
        [quizId],
      ).then(([rows]) => rows);

      const shouldAttempt = outcome === 'completed' || (outcome === 'in_progress' && rand() < 0.5);
      if (shouldAttempt) {
        const passed = outcome === 'completed' ? true : rand() < 0.35;
        const attemptNumber = 1;
        const startedAt = (completedAt ?? enrolledAt.add(between(2, 10), 'day'));
        const maxScore = quizQuestions.reduce((sum, q) => sum + Number(q.points), 0);
        const targetPercentage = passed ? between(course.quiz.passing, 100) : between(30, course.quiz.passing - 5);
        const attemptId = await insert('quiz_attempts', {
          quiz_id: quizId,
          employee_id: learner.id,
          enrollment_id: enrollmentId,
          attempt_number: attemptNumber,
          status: 'graded',
          score: 0,
          max_score: maxScore,
          percentage: 0,
          passed: passed ? 1 : 0,
          started_at: startedAt.format('YYYY-MM-DD HH:mm:ss'),
          expires_at: course.quiz.timeLimit ? startedAt.add(course.quiz.timeLimit, 'minute').format('YYYY-MM-DD HH:mm:ss') : null,
          submitted_at: startedAt.add(between(4, Math.max(5, (course.quiz.timeLimit ?? 20) - 1)), 'minute').format('YYYY-MM-DD HH:mm:ss'),
          graded_at: startedAt.add(course.quiz.timeLimit ?? 20, 'minute').format('YYYY-MM-DD HH:mm:ss'),
          graded_by: ldUserId,
        });
        attemptCount += 1;

        let earned = 0;
        for (const question of quizQuestions) {
          const points = Number(question.points);
          // Distribute correctness to roughly hit the target percentage.
          const correct = passed ? rand() < 0.92 : rand() < targetPercentage / 100;
          const awarded = correct ? points : 0;
          earned += awarded;

          let selectedOptionIds: number[] | null = null;
          let textAnswer: string | null = null;
          if (question.question_type === 'multiple_choice' || question.question_type === 'true_false' || question.question_type === 'multiple_select') {
            const options = await pool.execute<RowDataPacket[]>(
              'SELECT id, is_correct FROM quiz_options WHERE question_id = ? ORDER BY sort_order',
              [question.id],
            ).then(([rows]) => rows);
            if (question.question_type === 'multiple_select') {
              selectedOptionIds = correct
                ? options.filter((o) => o.is_correct).map((o) => o.id)
                : options.filter((o) => !o.is_correct).slice(0, 2).map((o) => o.id);
            } else {
              const chosen = correct ? options.find((o) => o.is_correct) : options.find((o) => !o.is_correct);
              selectedOptionIds = chosen ? [chosen.id] : [];
            }
          } else {
            textAnswer = correct
              ? (question.correct_answer ?? 'Correct response').split('|')[0]
              : 'Not sure about this one.';
          }

          await insert('quiz_answers', {
            attempt_id: attemptId,
            question_id: question.id,
            selected_option_ids: selectedOptionIds ? JSON.stringify(selectedOptionIds) : null,
            text_answer: textAnswer,
            is_correct: correct ? 1 : 0,
            points_awarded: awarded,
            needs_manual_review: question.question_type === 'short_answer' && !correct ? 1 : 0,
          });
        }

        const percentage = Number(((earned / maxScore) * 100).toFixed(2));
        const actuallyPassed = percentage >= course.quiz.passing;
        await pool.execute('UPDATE quiz_attempts SET score = ?, percentage = ?, passed = ? WHERE id = ?', [earned, percentage, actuallyPassed ? 1 : 0, attemptId]);

        // Certificate only when lessons complete AND assessment passed.
        if (outcome === 'completed' && actuallyPassed) {
          certificateCounter += 1;
          const certNumber = `BFC-CERT-${dayjs().format('YYYY')}-${String(certificateCounter).padStart(5, '0')}`;
          const durationMinutes = course.modules.flatMap((m) => m.lessons).reduce((s, l) => s + l.minutes, 0);
          const certPath = await writeCertificatePdf({
            certificateNumber: certNumber,
            employeeName: learner.name,
            employeeNo: learner.no,
            courseTitle: course.title,
            courseCode: course.code,
            completionDate: completedAt!.format('MMMM D, YYYY'),
            score: percentage,
            signatoryName: 'Maria Santos, L&D Manager',
            durationMinutes,
          });
          await insert('certificates', {
            certificate_number: certNumber,
            employee_id: learner.id,
            course_id: courseId,
            enrollment_id: enrollmentId,
            file_path: certPath,
            completion_date: dateStr(completedAt!),
            score: percentage,
            signatory_name: 'Maria Santos, L&D Manager',
            issued_at: completedAt!.add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
          });
        }
      }
    }
  }

  // --- Notifications -------------------------------------------------------
  console.log('[seed] notifications ...');
  const employeeUsers = employeeMeta.filter((e) => e.role === ROLE_CODES.EMPLOYEE);
  for (const learner of employeeUsers.slice(0, 24)) {
    const userId = userIds[learner.no];
    const enrollments = await pool.execute<RowDataPacket[]>(
      `SELECT ce.id, ce.status, ce.due_date, c.title FROM course_enrollments ce
       JOIN courses c ON c.id = ce.course_id WHERE ce.employee_id = ? ORDER BY ce.enrolled_at DESC LIMIT 4`,
      [learner.id],
    ).then(([rows]) => rows);

    for (const enrollment of enrollments) {
      await insert('notifications', {
        user_id: userId,
        type: 'course_assigned',
        title: 'New training assigned',
        message: `You have been assigned "${enrollment.title}". Complete it by ${enrollment.due_date}.`,
        link: `/learner/courses/${enrollment.id}`,
        is_read: rand() < 0.5 ? 1 : 0,
        read_at: rand() < 0.5 ? now() : null,
        created_at: dayjs().subtract(between(2, 20), 'day').format('YYYY-MM-DD HH:mm:ss'),
      });
      if (enrollment.status === 'completed') {
        await insert('notifications', {
          user_id: userId,
          type: 'certificate_issued',
          title: 'Certificate available',
          message: `Your certificate for "${enrollment.title}" is ready to download.`,
          link: '/learner/certificates',
          is_read: rand() < 0.4 ? 1 : 0,
          created_at: dayjs().subtract(between(0, 5), 'day').format('YYYY-MM-DD HH:mm:ss'),
        });
      } else if (dayjs(enrollment.due_date).isBefore(dayjs())) {
        await insert('notifications', {
          user_id: userId,
          type: 'course_overdue',
          title: 'Training overdue',
          message: `"${enrollment.title}" was due on ${enrollment.due_date}. Please complete it as soon as possible.`,
          link: `/learner/courses/${enrollment.id}`,
          is_read: 0,
          created_at: dayjs().subtract(between(0, 3), 'day').format('YYYY-MM-DD HH:mm:ss'),
        });
      } else {
        await insert('notifications', {
          user_id: userId,
          type: 'deadline_reminder',
          title: 'Upcoming deadline',
          message: `"${enrollment.title}" is due on ${enrollment.due_date}.`,
          link: `/learner/courses/${enrollment.id}`,
          is_read: 0,
          created_at: dayjs().subtract(between(0, 2), 'day').format('YYYY-MM-DD HH:mm:ss'),
        });
      }
    }
  }

  // --- Audit trail ---------------------------------------------------------
  console.log('[seed] audit logs ...');
  const auditActions = [
    { action: 'course.published', entity: 'course', description: 'Published course to the catalogue' },
    { action: 'employee.imported', entity: 'employee', description: 'Bulk imported employee records from CSV' },
    { action: 'training.assigned', entity: 'enrollment', description: 'Assigned mandatory training to a department' },
    { action: 'certificate.issued', entity: 'certificate', description: 'Issued completion certificate' },
    { action: 'user.role_changed', entity: 'user', description: 'Updated user role assignment' },
    { action: 'quiz.updated', entity: 'quiz', description: 'Revised assessment passing score' },
  ];
  for (let i = 0; i < 40; i += 1) {
    const admin = pick([userIds['BFC-0001'], userIds['BFC-0002'], userIds['BFC-0003'], userIds['BFC-0004']]);
    const entry = pick(auditActions);
    await insert('audit_logs', {
      user_id: admin,
      action: entry.action,
      entity_type: entry.entity,
      entity_id: String(between(1, 40)),
      description: entry.description,
      ip_address: '127.0.0.1',
      user_agent: 'BFC-LMS-Seed/1.0',
      metadata: JSON.stringify({ source: 'seed' }),
      created_at: dayjs().subtract(between(0, 30), 'day').format('YYYY-MM-DD HH:mm:ss'),
    });
  }

  // --- Summary -------------------------------------------------------------
  const counts: Record<string, number> = {};
  for (const table of ['employees', 'users', 'courses', 'lessons', 'learning_materials', 'quizzes', 'quiz_questions', 'course_enrollments', 'lesson_progress', 'quiz_attempts', 'certificates', 'notifications', 'audit_logs']) {
    counts[table] = await scalar<number>(`SELECT COUNT(*) FROM ${table}`);
  }
  console.log('[seed] complete:', JSON.stringify(counts, null, 2));
  console.log(`[seed] demo password for all accounts: ${DEMO_PASSWORD}`);
  console.log('[seed] demo logins: superadmin / ld.admin / hr.admin / dept.admin / employee');

  await pool.end();
}

main().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});