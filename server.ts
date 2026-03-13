import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbProvider = String(process.env.DB_PROVIDER || "sqlite").toLowerCase();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEMO_SUBJECTS = [
  { code: "20000-2003", name: "กิจกรรมเสริมสร้างสุจริต จิสอาสา", level: "ปวช.2 ทส." },
  { code: "21901-2011", name: "การพัฒนาแอปพลิเคชันบนอุปกรณ์เคลื่อนที่", level: "ปวช.2 ทส." },
  { code: "21910-1002", name: "วิเคราะห์ความต้องการทางธุรกิจ", level: "ปวช.3/2ทธด." },
  { code: "21910-2006", name: "โปรแกรมนำเสนอ", level: "ปวช.3/2ทธด." },
  { code: "21910-2017", name: "การพัฒนาโปรแกรมบนอุปกรณ์พกพาเบื้องต้น", level: "ปวช.2/1 ทธด." },
  { code: "21910-2017", name: "การพัฒนาโปรแกรมบนอุปกรณ์พกพาเบื้องต้น", level: "ปวช.2/2 ทธด." },
  { code: "21910-2021", name: "สื่อโมชันกราฟิก", level: "ปวช.2/1 ทธด." },
  { code: "21910-2021", name: "สื่อโมชันกราฟิก", level: "ปวช.2/2 ทธด." },
  { code: "31900-1002", name: "การจัดการข้อมูลขนาดใหญ่เบื้องต้น", level: "ปวส.2 ทส." }
];

const supabase: SupabaseClient | null =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false }
      })
    : null;

if (dbProvider === "supabase" && !supabase) {
  throw new Error("DB_PROVIDER=supabase แต่ยังไม่ได้ตั้ง SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY");
}

const db = new Database("classroom.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

const getMeta = (key: string): string | null => {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
};

const setMeta = (key: string, value: string): void => {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
};

// Initialize Database
// Migration: Check if users table has student_id, if not, drop it to recreate with correct schema
const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
const hasStudentId = tableInfo.some(col => col.name === 'student_id');
const hasPhone = tableInfo.some(col => col.name === 'phone');
const emailCol = tableInfo.find(col => col.name === 'email');
const emailIsNotNull = emailCol && emailCol.notnull === 1;

let hasSubmittedAt = false;
try {
  const submissionsInfo = db.prepare("PRAGMA table_info(submissions)").all() as any[];
  hasSubmittedAt = submissionsInfo.some(col => col.name === 'submitted_at');
} catch (e) {}

let hasAnnouncementPublishAt = false;
try {
  const announcementsInfo = db.prepare("PRAGMA table_info(announcements)").all() as any[];
  hasAnnouncementPublishAt = announcementsInfo.some(col => col.name === 'publish_at');
} catch (e) {}

// Check if we need to update subjects (if the first class name is the old one)
let isOldSubjects = false;
let hasNoStudents = false;
try {
  const firstClass = db.prepare("SELECT name FROM classes LIMIT 1").get() as { name: string } | undefined;
  isOldSubjects = !!(firstClass && firstClass.name === "กิจกรรมเสริมสร้างสุจริต จิตอาสา");
  
  const studentCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get() as { count: number };
  hasNoStudents = studentCount.count <= 1; // Only the default student
} catch (e) {
  // Table might not exist yet
}

if (!hasStudentId || emailIsNotNull || isOldSubjects || hasNoStudents || !hasSubmittedAt) {
  db.exec("DROP TABLE IF EXISTS announcements");
  db.exec("DROP TABLE IF EXISTS submissions");
  db.exec("DROP TABLE IF EXISTS assignments");
  db.exec("DROP TABLE IF EXISTS enrollments");
  db.exec("DROP TABLE IF EXISTS classes");
  db.exec("DROP TABLE IF EXISTS users");
}

// Non-destructive migration for phone login support.
if (hasStudentId && !hasPhone) {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    role TEXT CHECK(role IN ('teacher', 'student')) NOT NULL,
    profile_picture TEXT,
    contact_info TEXT,
    bio TEXT
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    teacher_id INTEGER,
    code TEXT UNIQUE NOT NULL,
    FOREIGN KEY(teacher_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    user_id INTEGER,
    class_id INTEGER,
    PRIMARY KEY(user_id, class_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER,
    student_id INTEGER,
    content TEXT,
    grade TEXT,
    status TEXT DEFAULT 'pending',
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assignment_id) REFERENCES assignments(id),
    FOREIGN KEY(student_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    content TEXT NOT NULL,
    publish_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    status TEXT CHECK(status IN ('present', 'late', 'absent')) NOT NULL,
    checked_by INTEGER,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_id, student_id, attendance_date),
    FOREIGN KEY(class_id) REFERENCES classes(id),
    FOREIGN KEY(student_id) REFERENCES users(id),
    FOREIGN KEY(checked_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS leaderboard_scores (
    class_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(class_id, user_id),
    FOREIGN KEY(class_id) REFERENCES classes(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS class_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    total_questions INTEGER NOT NULL DEFAULT 10,
    time_limit_sec INTEGER NOT NULL DEFAULT 20,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS class_game_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    choice_a TEXT NOT NULL,
    choice_b TEXT NOT NULL,
    choice_c TEXT NOT NULL,
    choice_d TEXT NOT NULL,
    correct_choice TEXT CHECK(correct_choice IN ('A','B','C','D')) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(class_id) REFERENCES classes(id),
    FOREIGN KEY(game_id) REFERENCES class_games(id)
  );
`);

if (!hasAnnouncementPublishAt) {
  try {
    db.exec("ALTER TABLE announcements ADD COLUMN publish_at DATETIME");
  } catch (e) {
    // Column may already exist in some environments.
  }
}

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL");

const normalizeThaiPhone = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Accept either 0XXXXXXXXX or +66/66XXXXXXXXX and normalize to 0XXXXXXXXX.
  if (/^0\d{9}$/.test(digits)) return digits;
  if (/^66\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return null;
};

const MASTER_TEACHER_PHONE = "0971615261";

const randomJoinCode = (): string => Math.random().toString(36).substring(2, 8).toUpperCase();

const resetTeachersInSqliteOnce = () => {
  const key = "teacher-reset-sqlite-v1";
  if (getMeta(key) === "done") return;

  const teacherIds = (db.prepare("SELECT id FROM users WHERE role = 'teacher'").all() as Array<{ id: number }>).map((row) => row.id);
  if (teacherIds.length > 0) {
    const placeholders = teacherIds.map(() => "?").join(",");
    db.prepare(`UPDATE classes SET teacher_id = NULL WHERE teacher_id IN (${placeholders})`).run(...teacherIds);
    db.prepare("DELETE FROM users WHERE role = 'teacher'").run();
  }

  setMeta(key, "done");
};

const resetTeachersAndSeedSupabaseOnce = async () => {
  if (!supabase) return;

  const key = "teacher-reset-supabase-v1";
  if (getMeta(key) === "done") return;

  const teachers = await supabase.from("users").select("id").eq("role", "teacher");
  if (teachers.error) {
    throw new Error("Failed to read teacher list from Supabase");
  }

  const teacherIds = (teachers.data || []).map((row) => row.id);
  if (teacherIds.length > 0) {
    const clearOwners = await supabase.from("classes").update({ teacher_id: null }).in("teacher_id", teacherIds);
    if (clearOwners.error) {
      throw new Error("Failed to clear class owners in Supabase");
    }

    const removeTeachers = await supabase.from("users").delete().eq("role", "teacher");
    if (removeTeachers.error) {
      throw new Error("Failed to delete teachers in Supabase");
    }
  }

  const existingClasses = await supabase.from("classes").select("name, description");
  if (existingClasses.error) {
    throw new Error("Failed to fetch classes from Supabase");
  }

  const classKeySet = new Set((existingClasses.data || []).map((row) => `${row.name}::${row.description || ""}`));
  const rowsToInsert = DEMO_SUBJECTS
    .map((subject) => ({
      name: subject.name,
      description: `รหัสวิชา: ${subject.code} | ระดับชั้น: ${subject.level}`,
      teacher_id: null,
      code: randomJoinCode()
    }))
    .filter((row) => !classKeySet.has(`${row.name}::${row.description}`));

  if (rowsToInsert.length > 0) {
    const inserted = await supabase.from("classes").insert(rowsToInsert);
    if (inserted.error) {
      throw new Error("Failed to seed subjects into Supabase");
    }
  }

  setMeta(key, "done");
};

resetTeachersInSqliteOnce();

// Seed initial user if none exists
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  db.prepare("INSERT INTO users (name, email, role) VALUES (?, ?, ?)").run("นักเรียนสาธิต", "student@example.com", "student");

  // Seed classes from the image
  const insertClass = db.prepare("INSERT INTO classes (name, description, teacher_id, code) VALUES (?, ?, ?, ?)");
  DEMO_SUBJECTS.forEach(s => {
    insertClass.run(s.name, `รหัสวิชา: ${s.code} | ระดับชั้น: ${s.level}`, null, randomJoinCode());
  });

  // Seed students for ปวช.2/1 ทธด. from the image
  const students_2_1 = [
    { id: "68219100001", name: "นายกวี กองลี" },
    { id: "68219100002", name: "นายกาญจนวัฒน์ พงษ์ทองเจริญ" },
    { id: "68219100003", name: "นางสาวฐิตาภา ประทุมวาล" },
    { id: "68219100004", name: "นางสาวขวัญรัตน์ ทองสุข" },
    { id: "68219100005", name: "นายภิชานนท์ ทำเนียบ" },
    { id: "68219100006", name: "นายชยพล เนาวราช" },
    { id: "68219100007", name: "นางสาวบุษกร สมุทรเขตต์" },
    { id: "68219100008", name: "นายฐิติภัค ศรีแก้ว" },
    { id: "68219100009", name: "นางสาวณัฏฐธิดา พุทธสาราษฎร์" },
    { id: "68219100010", name: "นางสาวสิริวิมล อินทร์อ้วน" },
    { id: "68219100011", name: "นางสาวธัญชนก เจน" },
    { id: "68219100012", name: "นายนครินทร์ บุบผามาลัง" },
    { id: "68219100013", name: "นางสาวเบญจทิพย์ โบไธสง" },
    { id: "68219100014", name: "นางสาวปพัชญา รูปคม" },
    { id: "68219100015", name: "นางสาวปริณดา ปิ่นแก้ว" },
    { id: "68219100016", name: "นางสาวปาริฉัตร หวังเจริญ" },
    { id: "68219100017", name: "นายเปรมยวัฒน์ พิมศรี" },
    { id: "68219100019", name: "นายพิริยะ ปรึกมล" },
    { id: "68219100020", name: "นางสาวภัควลัญช์ ทรายแก้ว" },
    { id: "68219100023", name: "นางสาววริสรา สุขสินพรสมบัติ" },
    { id: "68219100024", name: "นางสาววรวลัญช์ ชคัตประภาศ" },
    { id: "68219100025", name: "นายวีรภัทร รัตนแสง" },
    { id: "68219100026", name: "นางสาวศิราพร ซึ้งเจริญ" },
    { id: "68219100027", name: "นายศุภกิตติ์ ศรีสวัสดิ์" },
    { id: "68219100028", name: "นางสาวสุพิชญา พ่วงเจริญ" },
    { id: "68219100029", name: "นายอรรคพล ประหยัดจิตร" },
    { id: "68219100030", name: "นายอริญชย์ จำรูญศิริ" }
  ];

  const insertUser = db.prepare("INSERT INTO users (name, student_id, role) VALUES (?, ?, ?)");
  const insertEnrollment = db.prepare("INSERT INTO enrollments (user_id, class_id) VALUES (?, ?)");
  
  // Get class IDs for ปวช.2/1 ทธด.
  const classIds = db.prepare("SELECT id FROM classes WHERE description LIKE '%ปวช.2/1 ทธด.%'").all() as { id: number }[];

  students_2_1.forEach(s => {
    const info = insertUser.run(s.name, s.id, "student");
    const userId = info.lastInsertRowid;
    classIds.forEach(c => {
      insertEnrollment.run(userId, c.id);
    });
  });

  // Seed initial assignments
  const classList = db.prepare("SELECT id FROM classes").all() as { id: number }[];
  classList.forEach(cls => {
    db.prepare("INSERT INTO assignments (class_id, title, description, due_date) VALUES (?, ?, ?, ?)").run(
      cls.id, 
      'Initial commit', 
      'Initial commit for the project', 
      '2024-09-01'
    );
  });
}

async function startServer() {
  if (dbProvider === "supabase") {
    await resetTeachersAndSeedSupabaseOnce();
  }

  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const PORT = 3000;

  const clients = new Map<number, WebSocket>();

  wss.on("connection", (ws) => {
    let userId: number | null = null;
    ws.on("message", (message) => {
      const data = JSON.parse(message.toString());
      if (data.type === "auth") {
        userId = data.userId;
        if (userId) clients.set(userId, ws);
      }
    });

    ws.on("close", () => {
      if (userId) clients.delete(userId);
    });
  });

  const broadcastToClass = (classId: number, notification: any) => {
    const students = db.prepare("SELECT user_id FROM enrollments WHERE class_id = ?").all(classId) as { user_id: number }[];
    students.forEach(({ user_id }) => {
      const client = clients.get(user_id);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(notification));
      }
    });
  };

  const isClassOwnerTeacher = async (classId: number | string, actorId: number | string | undefined) => {
    if (!actorId) return false;

    if (dbProvider === "supabase" && supabase) {
      const actorIdNum = Number(actorId);
      const classIdNum = Number(classId);
      if (!Number.isFinite(actorIdNum) || !Number.isFinite(classIdNum)) return false;

      const userResult = await supabase
        .from("users")
        .select("id, role")
        .eq("id", actorIdNum)
        .single();

      if (userResult.error || !userResult.data || userResult.data.role !== "teacher") {
        return false;
      }

      const classResult = await supabase
        .from("classes")
        .select("id")
        .eq("id", classIdNum)
        .eq("teacher_id", actorIdNum)
        .single();

      return !!classResult.data && !classResult.error;
    }

    const owner = db.prepare(`
      SELECT c.id
      FROM classes c
      JOIN users u ON u.id = ?
      WHERE c.id = ? AND c.teacher_id = u.id AND u.role = 'teacher'
    `).get(actorId, classId);
    return !!owner;
  };

  const updateLeaderboardScore = async (classId: number, userId: number, deltaPoints: number) => {
    if (!Number.isFinite(classId) || !Number.isFinite(userId)) {
      return { error: "Invalid class id or user id" as const };
    }
    if (!Number.isFinite(deltaPoints) || deltaPoints === 0) {
      return { error: "Points must be a non-zero number" as const };
    }

    if (dbProvider === "supabase") {
      if (!supabase) return { error: "Supabase is not configured" as const };

      const enrollment = await supabase
        .from("enrollments")
        .select("user_id")
        .eq("class_id", classId)
        .eq("user_id", userId)
        .limit(1);

      if (enrollment.error) {
        return { error: "Failed to update score" as const };
      }

      if (!enrollment.data || enrollment.data.length === 0) {
        return { error: "เฉพาะนักเรียนในชั้นเรียนนี้เท่านั้น" as const };
      }

      const current = await supabase
        .from("leaderboard_scores")
        .select("score, streak, best_streak")
        .eq("class_id", classId)
        .eq("user_id", userId)
        .maybeSingle();

      if (current.error) {
        return { error: "Failed to update score" as const };
      }

      const previousScore = Number(current.data?.score || 0);
      const previousStreak = Number(current.data?.streak || 0);
      const previousBestStreak = Number(current.data?.best_streak || 0);

      const score = Math.max(0, previousScore + deltaPoints);
      const streak = deltaPoints > 0 ? previousStreak + 1 : 0;
      const bestStreak = Math.max(previousBestStreak, streak);

      const upsertResult = await supabase
        .from("leaderboard_scores")
        .upsert(
          {
            class_id: classId,
            user_id: userId,
            score,
            streak,
            best_streak: bestStreak,
            updated_at: new Date().toISOString()
          },
          { onConflict: "class_id,user_id" }
        )
        .select("class_id, user_id, score, streak, best_streak")
        .single();

      if (upsertResult.error || !upsertResult.data) {
        return { error: "Failed to update score" as const };
      }

      return { data: upsertResult.data };
    }

    const enrolled = db
      .prepare("SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?")
      .get(classId, userId);

    if (!enrolled) {
      return { error: "เฉพาะนักเรียนในชั้นเรียนนี้เท่านั้น" as const };
    }

    const current = db
      .prepare("SELECT score, streak, best_streak FROM leaderboard_scores WHERE class_id = ? AND user_id = ?")
      .get(classId, userId) as { score: number; streak: number; best_streak: number } | undefined;

    const previousScore = Number(current?.score || 0);
    const previousStreak = Number(current?.streak || 0);
    const previousBestStreak = Number(current?.best_streak || 0);

    const score = Math.max(0, previousScore + deltaPoints);
    const streak = deltaPoints > 0 ? previousStreak + 1 : 0;
    const bestStreak = Math.max(previousBestStreak, streak);

    db.prepare(`
      INSERT INTO leaderboard_scores (class_id, user_id, score, streak, best_streak, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(class_id, user_id)
      DO UPDATE SET
        score = excluded.score,
        streak = excluded.streak,
        best_streak = excluded.best_streak,
        updated_at = CURRENT_TIMESTAMP
    `).run(classId, userId, score, streak, bestStreak);

    return { data: { class_id: classId, user_id: userId, score, streak, best_streak: bestStreak } };
  };

  // Background task for due dates (every hour)
  setInterval(() => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const approachingAssignments = db.prepare("SELECT * FROM assignments WHERE due_date = ?").all(tomorrowStr) as any[];
    approachingAssignments.forEach(ass => {
      broadcastToClass(ass.class_id, {
        type: "notification",
        title: "ใกล้กำหนดส่งงาน!",
        message: `งาน "${ass.title}" จะครบกำหนดส่งในวันพรุ่งนี้`,
        classId: ass.class_id
      });
    });
  }, 3600000); // 1 hour

  app.use(express.json());

  app.get("/api/health/db", async (_req, res) => {
    if (!supabase) {
      return res.json({
        provider: dbProvider,
        supabaseConfigured: false,
        supabaseConnected: false,
        message: "Supabase env vars not configured"
      });
    }

    const { error } = await supabase.from("users").select("id").limit(1);
    res.json({
      provider: dbProvider,
      supabaseConfigured: true,
      supabaseConnected: !error,
      error: error?.message || null
    });
  });

  // Auth Routes
  app.post("/api/auth/login", async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: "Identifier required" });

    const rawIdentifier = String(identifier).trim();
    const normalizedPhone = normalizeThaiPhone(rawIdentifier);
    const isEmailIdentifier = rawIdentifier.includes("@");
    const isPhoneIdentifier = !!normalizedPhone;

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      let user: any = null;

      const byStudentId = await supabase
        .from("users")
        .select("*")
        .eq("student_id", rawIdentifier)
        .limit(1)
        .maybeSingle();
      if (byStudentId.error) {
        return res.status(500).json({ error: "Failed to query user" });
      }
      user = byStudentId.data;

      if (!user) {
        const byEmail = await supabase
          .from("users")
          .select("*")
          .eq("email", rawIdentifier)
          .limit(1)
          .maybeSingle();
        if (byEmail.error) {
          return res.status(500).json({ error: "Failed to query user" });
        }
        user = byEmail.data;
      }

      if (!user && normalizedPhone) {
        const byPhone = await supabase
          .from("users")
          .select("*")
          .eq("phone", normalizedPhone)
          .limit(1)
          .maybeSingle();
        if (byPhone.error) {
          return res.status(500).json({ error: "Failed to query user" });
        }
        user = byPhone.data;
      }

      if (!user) {
        if (!isEmailIdentifier && !isPhoneIdentifier) {
          return res.status(403).json({ error: "ไม่พบรหัสนักศึกษาในระบบ กรุณาให้ครูเพิ่มรายชื่อก่อนเข้าสู่ระบบ" });
        }

        return res.status(403).json({ error: "บัญชีครูนี้ไม่มีในระบบ กรุณาให้ผู้ดูแลเพิ่มบัญชีก่อนเข้าสู่ระบบ" });
      }

      if (user.role === "student") {
        if (!user.student_id) {
          return res.status(403).json({ error: "บัญชีนักเรียนนี้ยังไม่ได้รับอนุญาตให้เข้าสู่ระบบ" });
        }

        const enrollmentResult = await supabase
          .from("enrollments")
          .select("class_id")
          .eq("user_id", user.id)
          .limit(1);

        if (enrollmentResult.error) {
          return res.status(500).json({ error: "Failed to verify student access" });
        }

        if (!enrollmentResult.data || enrollmentResult.data.length === 0) {
          return res.status(403).json({ error: "บัญชีนักเรียนนี้ยังไม่ถูกเพิ่มเข้าชั้นเรียน กรุณาให้ครูเพิ่มรายชื่อก่อน" });
        }
      }

      // For demo: special teacher phone owns all classes.
      if (user.role === "teacher") {
        if (user.phone === MASTER_TEACHER_PHONE) {
          const assignAll = await supabase.from("classes").update({ teacher_id: user.id }).neq("id", 0);
          if (assignAll.error) {
            return res.status(500).json({ error: "Failed to assign all classes to master teacher" });
          }
        } else {
          const teacherClasses = await supabase
            .from("classes")
            .select("id", { count: "exact", head: true })
            .eq("teacher_id", user.id);

          if (!teacherClasses.error && (teacherClasses.count ?? 0) === 0) {
            await supabase.from("classes").update({ teacher_id: user.id }).is("teacher_id", null);
            await supabase.from("classes").update({ teacher_id: user.id }).eq("teacher_id", 1);
          }
        }
      }

      return res.json(user);
    }

    let user = db
      .prepare("SELECT * FROM users WHERE student_id = ? OR email = ? OR phone = ?")
      .get(rawIdentifier, rawIdentifier, normalizedPhone) as any;
    
    if (!user) {
      if (!isEmailIdentifier && !isPhoneIdentifier) {
        return res.status(403).json({ error: "ไม่พบรหัสนักศึกษาในระบบ กรุณาให้ครูเพิ่มรายชื่อก่อนเข้าสู่ระบบ" });
      }

      return res.status(403).json({ error: "บัญชีครูนี้ไม่มีในระบบ กรุณาให้ผู้ดูแลเพิ่มบัญชีก่อนเข้าสู่ระบบ" });
    }

    if (user.role === "student") {
      if (!user.student_id) {
        return res.status(403).json({ error: "บัญชีนักเรียนนี้ยังไม่ได้รับอนุญาตให้เข้าสู่ระบบ" });
      }

      const enrolled = db
        .prepare("SELECT 1 FROM enrollments WHERE user_id = ? LIMIT 1")
        .get(user.id);

      if (!enrolled) {
        return res.status(403).json({ error: "บัญชีนักเรียนนี้ยังไม่ถูกเพิ่มเข้าชั้นเรียน กรุณาให้ครูเพิ่มรายชื่อก่อน" });
      }
    }

    // For demo: special teacher phone owns all classes.
    if (user.role === "teacher") {
      if (user.phone === MASTER_TEACHER_PHONE) {
        db.prepare("UPDATE classes SET teacher_id = ?").run(user.id);
      } else {
        const teacherClasses = db.prepare("SELECT COUNT(*) as count FROM classes WHERE teacher_id = ?").get(user.id) as { count: number };
        if (teacherClasses.count === 0) {
          db.prepare("UPDATE classes SET teacher_id = ? WHERE teacher_id IS NULL OR teacher_id = 1").run(user.id);
        }
      }
    }

    res.json(user);
  });

  // API Routes
  app.get("/api/users", async (_req, res) => {
    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const { data, error } = await supabase.from("users").select("*").order("id", { ascending: true });
      if (error) {
        return res.status(500).json({ error: "Failed to fetch users" });
      }
      return res.json(data || []);
    }

    const users = db.prepare("SELECT * FROM users").all();
    return res.json(users);
  });

  app.patch("/api/users/:id", async (req, res) => {
    const { name, profile_picture, contact_info, bio, student_id, email, phone } = req.body;
    const { id } = req.params;
    const normalizedPhone = phone ? normalizeThaiPhone(String(phone).trim()) : null;

    if (phone && !normalizedPhone) {
      return res.status(400).json({ error: "เบอร์โทรต้องเป็นรูปแบบ 0XXXXXXXXX หรือ +66XXXXXXXXX" });
    }

    try {
      if (dbProvider === "supabase") {
        if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (profile_picture !== undefined) updates.profile_picture = profile_picture;
        if (contact_info !== undefined) updates.contact_info = contact_info;
        if (bio !== undefined) updates.bio = bio;
        if (student_id !== undefined) updates.student_id = student_id;
        if (email !== undefined) updates.email = email;
        if (phone !== undefined) updates.phone = normalizedPhone;

        const updated = await supabase
          .from("users")
          .update(updates)
          .eq("id", Number(id))
          .select("*")
          .single();

        if (updated.error) {
          return res.status(500).json({ error: "Failed to update profile" });
        }

        return res.json(updated.data);
      }

      db.prepare(`
        UPDATE users 
        SET name = COALESCE(?, name), 
            profile_picture = COALESCE(?, profile_picture), 
            contact_info = COALESCE(?, contact_info), 
            bio = COALESCE(?, bio),
            student_id = COALESCE(?, student_id),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone)
        WHERE id = ?
      `).run(name, profile_picture, contact_info, bio, student_id, email, normalizedPhone, id);
      const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return res.json(updatedUser);
    } catch (e) {
      return res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/classes", async (req, res) => {
    const { userId } = req.query;

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      if (userId) {
        const uid = Number(userId);
        if (!Number.isFinite(uid)) {
          return res.status(400).json({ error: "Invalid userId" });
        }

        const teacherClassesResult = await supabase
          .from("classes")
          .select("*")
          .eq("teacher_id", uid);

        if (teacherClassesResult.error) {
          return res.status(500).json({ error: "Failed to fetch classes" });
        }

        const enrollmentResult = await supabase
          .from("enrollments")
          .select("class_id")
          .eq("user_id", uid);

        if (enrollmentResult.error) {
          return res.status(500).json({ error: "Failed to fetch classes" });
        }

        const enrolledClassIds = (enrollmentResult.data || [])
          .map((row) => row.class_id)
          .filter((classId): classId is number => Number.isFinite(classId));

        let enrolledClasses: any[] = [];
        if (enrolledClassIds.length > 0) {
          const enrolledClassesResult = await supabase
            .from("classes")
            .select("*")
            .in("id", enrolledClassIds);

          if (enrolledClassesResult.error) {
            return res.status(500).json({ error: "Failed to fetch classes" });
          }
          enrolledClasses = enrolledClassesResult.data || [];
        }

        const merged = [...(teacherClassesResult.data || []), ...enrolledClasses];
        const uniqueById = new Map<number, any>();
        merged.forEach((row) => {
          if (Number.isFinite(row?.id)) uniqueById.set(row.id, row);
        });

        return res.json([...uniqueById.values()]);
      }

      const allClasses = await supabase.from("classes").select("*");
      if (allClasses.error) {
        return res.status(500).json({ error: "Failed to fetch classes" });
      }
      return res.json(allClasses.data || []);
    }

    if (userId) {
      const classes = db.prepare(`
        SELECT c.* FROM classes c
        JOIN enrollments e ON c.id = e.class_id
        WHERE e.user_id = ?
        UNION
        SELECT * FROM classes WHERE teacher_id = ?
      `).all(userId, userId);
      return res.json(classes);
    }

    const classes = db.prepare("SELECT * FROM classes").all();
    return res.json(classes);
  });

  app.post("/api/classes", (req, res) => {
    const { name, description, teacherId } = req.body;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      const info = db.prepare("INSERT INTO classes (name, description, teacher_id, code) VALUES (?, ?, ?, ?)").run(name, description, teacherId, code);
      res.json({ id: info.lastInsertRowid, code });
    } catch (e) {
      res.status(500).json({ error: "Failed to create class" });
    }
  });

  app.delete("/api/classes/:id", async (req, res) => {
    const { id } = req.params;
    const { actorId } = req.body || {};
    const classId = Number(id);
    const userId = Number(actorId);

    if (!Number.isFinite(classId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "Invalid classId or actorId" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const actorResult = await supabase
        .from("users")
        .select("id, role, phone")
        .eq("id", userId)
        .maybeSingle();

      if (actorResult.error || !actorResult.data) {
        return res.status(404).json({ error: "ไม่พบผู้ใช้งาน" });
      }

      if (actorResult.data.role !== "teacher") {
        return res.status(403).json({ error: "เฉพาะครูเท่านั้นที่ลบวิชาได้" });
      }

      const classResult = await supabase
        .from("classes")
        .select("id, teacher_id")
        .eq("id", classId)
        .maybeSingle();

      if (classResult.error || !classResult.data) {
        return res.status(404).json({ error: "ไม่พบวิชา" });
      }

      const isMasterTeacher = actorResult.data.phone === MASTER_TEACHER_PHONE;
      const isOwner = classResult.data.teacher_id === userId;
      if (!isMasterTeacher && !isOwner) {
        return res.status(403).json({ error: "ไม่มีสิทธิ์ลบวิชานี้" });
      }

      const assignmentsResult = await supabase
        .from("assignments")
        .select("id")
        .eq("class_id", classId);

      if (assignmentsResult.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const assignmentIds = (assignmentsResult.data || []).map((row) => row.id).filter((value): value is number => Number.isFinite(value));

      if (assignmentIds.length > 0) {
        const removeSubmissions = await supabase.from("submissions").delete().in("assignment_id", assignmentIds);
        if (removeSubmissions.error) {
          return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
        }
      }

      const removeAssignments = await supabase.from("assignments").delete().eq("class_id", classId);
      if (removeAssignments.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeAnnouncements = await supabase.from("announcements").delete().eq("class_id", classId);
      if (removeAnnouncements.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeAttendance = await supabase.from("attendance_records").delete().eq("class_id", classId);
      if (removeAttendance.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeEnrollments = await supabase.from("enrollments").delete().eq("class_id", classId);
      if (removeEnrollments.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeLeaderboard = await supabase.from("leaderboard_scores").delete().eq("class_id", classId);
      if (removeLeaderboard.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeGames = await supabase.from("class_games").delete().eq("class_id", classId);
      if (removeGames.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeGameQuestions = await supabase
        .from("class_game_questions")
        .delete()
        .eq("class_id", classId);
      if (removeGameQuestions.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      const removeClass = await supabase.from("classes").delete().eq("id", classId);
      if (removeClass.error) {
        return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
      }

      return res.json({ success: true });
    }

    const actor = db.prepare("SELECT id, role, phone FROM users WHERE id = ?").get(userId) as { id: number; role: string; phone?: string | null } | undefined;
    if (!actor) {
      return res.status(404).json({ error: "ไม่พบผู้ใช้งาน" });
    }
    if (actor.role !== "teacher") {
      return res.status(403).json({ error: "เฉพาะครูเท่านั้นที่ลบวิชาได้" });
    }

    const classRow = db.prepare("SELECT id, teacher_id FROM classes WHERE id = ?").get(classId) as { id: number; teacher_id: number | null } | undefined;
    if (!classRow) {
      return res.status(404).json({ error: "ไม่พบวิชา" });
    }

    const isMasterTeacher = actor.phone === MASTER_TEACHER_PHONE;
    const isOwner = classRow.teacher_id === userId;
    if (!isMasterTeacher && !isOwner) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ลบวิชานี้" });
    }

    try {
      const assignmentIds = (db.prepare("SELECT id FROM assignments WHERE class_id = ?").all(classId) as Array<{ id: number }>).map((row) => row.id);

      if (assignmentIds.length > 0) {
        const placeholders = assignmentIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM submissions WHERE assignment_id IN (${placeholders})`).run(...assignmentIds);
      }

      db.prepare("DELETE FROM assignments WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM announcements WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM attendance_records WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM enrollments WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM leaderboard_scores WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM class_game_questions WHERE game_id IN (SELECT id FROM class_games WHERE class_id = ?)").run(classId);
      db.prepare("DELETE FROM class_games WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM classes WHERE id = ?").run(classId);

      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: "ไม่สามารถลบวิชาได้" });
    }
  });

  app.post("/api/classes/join", (req, res) => {
    const { code, userId } = req.body;
    const classroom = db.prepare("SELECT id FROM classes WHERE code = ?").get(code) as { id: number } | undefined;
    if (!classroom) return res.status(404).json({ error: "Class not found" });
    
    try {
      db.prepare("INSERT INTO enrollments (user_id, class_id) VALUES (?, ?)").run(userId, classroom.id);
      res.json({ success: true, classId: classroom.id });
    } catch (e) {
      res.status(400).json({ error: "Already enrolled or error" });
    }
  });

  app.get("/api/classes/:id/people", async (req, res) => {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      try {
        const classResult = await supabase
          .from("classes")
          .select("teacher_id")
          .eq("id", classId)
          .maybeSingle();

        if (classResult.error) {
          return res.status(500).json({ error: "Failed to fetch class people" });
        }

        if (!classResult.data) {
          return res.status(404).json({ error: "Class not found" });
        }

        let teacher: any = null;
        const teacherId = classResult.data.teacher_id;
        if (Number.isFinite(teacherId)) {
          const teacherResult = await supabase
            .from("users")
            .select("*")
            .eq("id", teacherId)
            .maybeSingle();

          if (teacherResult.error) {
            return res.status(500).json({ error: "Failed to fetch class people" });
          }
          teacher = teacherResult.data || null;
        }

        const enrollmentsResult = await supabase
          .from("enrollments")
          .select("user_id")
          .eq("class_id", classId);

        if (enrollmentsResult.error) {
          return res.status(500).json({ error: "Failed to fetch class people" });
        }

        const studentIds = (enrollmentsResult.data || [])
          .map((row) => row.user_id)
          .filter((id): id is number => Number.isFinite(id));

        let students: any[] = [];
        if (studentIds.length > 0) {
          const studentsResult = await supabase
            .from("users")
            .select("*")
            .eq("role", "student")
            .in("id", studentIds)
            .order("name", { ascending: true });

          if (studentsResult.error) {
            return res.status(500).json({ error: "Failed to fetch class people" });
          }
          students = studentsResult.data || [];
        }

        return res.json({ teacher, students });
      } catch (e) {
        return res.status(500).json({ error: "Failed to fetch class people" });
      }
    }

    try {
      const teacher = db.prepare(`
        SELECT u.* FROM users u
        JOIN classes c ON c.teacher_id = u.id
        WHERE c.id = ?
      `).get(classId);

      const students = db.prepare(`
        SELECT u.* FROM users u
        JOIN enrollments e ON e.user_id = u.id
        WHERE e.class_id = ? AND u.role = 'student'
        ORDER BY u.name ASC
      `).all(classId);

      return res.json({ teacher, students });
    } catch (e) {
      return res.status(500).json({ error: "Failed to fetch class people" });
    }
  });

  app.patch("/api/classes/:classId/students/:studentId", async (req, res) => {
    const { classId, studentId } = req.params;
    const { actorId, name, student_id, bio } = req.body;

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไขนักเรียนในชั้นนี้" });
    }

    const enrollment = db
      .prepare("SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?")
      .get(classId, studentId);

    if (!enrollment) {
      return res.status(404).json({ error: "ไม่พบนักเรียนในชั้นเรียนนี้" });
    }

    try {
      db.prepare(`
        UPDATE users
        SET name = COALESCE(?, name),
            student_id = COALESCE(?, student_id),
            bio = COALESCE(?, bio)
        WHERE id = ? AND role = 'student'
      `).run(name, student_id, bio, studentId);

      const updatedStudent = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(studentId);

      res.json(updatedStudent);
    } catch (e) {
      res.status(400).json({ error: "ไม่สามารถแก้ไขข้อมูลนักเรียนได้" });
    }
  });

  app.delete("/api/classes/:classId/students/:studentId", async (req, res) => {
    const { classId, studentId } = req.params;
    const { actorId } = req.body;

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ลบนักเรียนออกจากชั้นนี้" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const classIdNum = Number(classId);
      const studentIdNum = Number(studentId);

      const existing = await supabase
        .from("enrollments")
        .select("user_id")
        .eq("class_id", classIdNum)
        .eq("user_id", studentIdNum)
        .limit(1);

      if (existing.error) {
        return res.status(500).json({ error: "ไม่สามารถตรวจสอบรายชื่อนักเรียนในชั้นเรียนได้" });
      }

      if (!existing.data || existing.data.length === 0) {
        return res.status(404).json({ error: "ไม่พบนักเรียนในชั้นเรียนนี้" });
      }

      const deleted = await supabase
        .from("enrollments")
        .delete()
        .eq("class_id", classIdNum)
        .eq("user_id", studentIdNum);

      if (deleted.error) {
        return res.status(500).json({ error: "ไม่สามารถลบนักเรียนออกจากชั้นเรียนได้" });
      }

      return res.json({ success: true });
    }

    try {
      const result = db
        .prepare("DELETE FROM enrollments WHERE class_id = ? AND user_id = ?")
        .run(classId, studentId);

      if (result.changes === 0) {
        return res.status(404).json({ error: "ไม่พบนักเรียนในชั้นเรียนนี้" });
      }

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "ไม่สามารถลบนักเรียนออกจากชั้นเรียนได้" });
    }
  });

  app.post("/api/classes/:classId/students", async (req, res) => {
    const { classId } = req.params;
    const { actorId, studentId, fullName, identifier, name, bio } = req.body;

    const normalizedStudentId = String(studentId ?? identifier ?? '').trim();
    const normalizedFullName = String(fullName ?? name ?? '').trim().replace(/\s+/g, ' ');

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์เพิ่มนักเรียนในชั้นนี้" });
    }

    if (!normalizedStudentId || !normalizedFullName) {
      return res.status(400).json({ error: "กรุณาระบุรหัสนักศึกษาและชื่อ-สกุล" });
    }

    if (!/^\d{11}$/.test(normalizedStudentId)) {
      return res.status(400).json({ error: "รหัสนักศึกษาต้องเป็นตัวเลข 11 หลัก" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const classIdNum = Number(classId);
      if (!Number.isFinite(classIdNum)) {
        return res.status(400).json({ error: "รหัสชั้นเรียนไม่ถูกต้อง" });
      }

      try {
        const userByStudentId = await supabase
          .from("users")
          .select("*")
          .eq("student_id", normalizedStudentId)
          .limit(1)
          .maybeSingle();

        if (userByStudentId.error) {
          return res.status(500).json({ error: "ไม่สามารถตรวจสอบรหัสนักศึกษาได้" });
        }

        if (userByStudentId.data && userByStudentId.data.role !== "student") {
          return res.status(409).json({
            error: `รหัสนักศึกษา ${normalizedStudentId} ถูกใช้โดยบัญชีที่ไม่ใช่นักเรียนแล้ว`
          });
        }

        let student = userByStudentId.data && userByStudentId.data.role === "student" ? userByStudentId.data : null;

        const enrolledIdsResult = await supabase
          .from("enrollments")
          .select("user_id")
          .eq("class_id", classIdNum);

        if (enrolledIdsResult.error) {
          return res.status(500).json({ error: "ไม่สามารถตรวจสอบรายชื่อนักเรียนในชั้นเรียนได้" });
        }

        const enrolledIds = (enrolledIdsResult.data || []).map((item: any) => Number(item.user_id)).filter((id: number) => Number.isFinite(id));
        if (enrolledIds.length > 0) {
          const studentsInClassResult = await supabase
            .from("users")
            .select("id, student_id, name")
            .eq("role", "student")
            .in("id", enrolledIds);

          if (studentsInClassResult.error) {
            return res.status(500).json({ error: "ไม่สามารถตรวจสอบข้อมูลนักเรียนในชั้นเรียนได้" });
          }

          const normalizedName = normalizedFullName.toLowerCase().trim();
          const duplicateNameInClass = (studentsInClassResult.data || []).find((item: any) => {
            const itemName = String(item.name || "").toLowerCase().trim();
            return itemName === normalizedName;
          });

          if (duplicateNameInClass && (!student || duplicateNameInClass.id !== student.id)) {
            return res.status(409).json({
              error: `ชื่อ-สกุล \"${normalizedFullName}\" มีอยู่ในชั้นเรียนแล้ว (รหัส ${duplicateNameInClass.student_id || '-'})`
            });
          }
        }

        if (!student) {
          const created = await supabase
            .from("users")
            .insert({
              name: normalizedFullName,
              student_id: normalizedStudentId,
              email: null,
              role: "student",
              bio: bio || null
            })
            .select("*")
            .single();

          if (created.error || !created.data) {
            return res.status(400).json({ error: "ไม่สามารถเพิ่มนักเรียนเข้าชั้นเรียนได้" });
          }
          student = created.data;
        } else {
          const updated = await supabase
            .from("users")
            .update({
              name: normalizedFullName || student.name,
              bio: bio ?? student.bio ?? null
            })
            .eq("id", student.id)
            .select("*")
            .single();

          if (updated.error || !updated.data) {
            return res.status(400).json({ error: "ไม่สามารถอัปเดตข้อมูลนักเรียนได้" });
          }
          student = updated.data;
        }

        const alreadyEnrolled = await supabase
          .from("enrollments")
          .select("user_id")
          .eq("user_id", student.id)
          .eq("class_id", classIdNum)
          .limit(1);

        if (alreadyEnrolled.error) {
          return res.status(500).json({ error: "ไม่สามารถตรวจสอบการลงทะเบียนชั้นเรียนได้" });
        }

        if (alreadyEnrolled.data && alreadyEnrolled.data.length > 0) {
          return res.status(409).json({
            error: `รหัสนักศึกษา ${normalizedStudentId} อยู่ในชั้นเรียนนี้แล้ว`
          });
        }

        const enrolled = await supabase
          .from("enrollments")
          .insert({ user_id: student.id, class_id: classIdNum });

        if (enrolled.error) {
          return res.status(400).json({ error: "ไม่สามารถเพิ่มนักเรียนเข้าชั้นเรียนได้" });
        }

        return res.json({ student, enrolled: true });
      } catch (e) {
        return res.status(400).json({ error: "ไม่สามารถเพิ่มนักเรียนเข้าชั้นเรียนได้" });
      }
    }

    try {
      const userByStudentId = db.prepare(`
        SELECT * FROM users WHERE student_id = ?
      `).get(normalizedStudentId) as any;

      if (userByStudentId && userByStudentId.role !== 'student') {
        return res.status(409).json({
          error: `รหัสนักศึกษา ${normalizedStudentId} ถูกใช้โดยบัญชีที่ไม่ใช่นักเรียนแล้ว`
        });
      }

      let student = userByStudentId && userByStudentId.role === 'student' ? userByStudentId : null;

      const duplicateNameInClass = db.prepare(`
        SELECT u.id, u.student_id, u.name
        FROM users u
        JOIN enrollments e ON e.user_id = u.id
        WHERE e.class_id = ?
          AND u.role = 'student'
          AND lower(trim(u.name)) = lower(trim(?))
      `).get(classId, normalizedFullName) as any;

      if (duplicateNameInClass && (!student || duplicateNameInClass.id !== student.id)) {
        return res.status(409).json({
          error: `ชื่อ-สกุล \"${normalizedFullName}\" มีอยู่ในชั้นเรียนแล้ว (รหัส ${duplicateNameInClass.student_id || '-'})`
        });
      }

      if (!student) {
        const info = db.prepare(`
          INSERT INTO users (name, student_id, email, role, bio)
          VALUES (?, ?, ?, 'student', ?)
        `).run(normalizedFullName, normalizedStudentId, null, bio || null);
        student = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
      } else if (normalizedFullName || bio) {
        db.prepare(`
          UPDATE users
          SET name = COALESCE(?, name),
              bio = COALESCE(?, bio)
          WHERE id = ?
        `).run(normalizedFullName, bio, student.id);
        student = db.prepare("SELECT * FROM users WHERE id = ?").get(student.id);
      }

      const alreadyEnrolled = db
        .prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND class_id = ?")
        .get(student.id, classId);

      if (alreadyEnrolled) {
        return res.status(409).json({
          error: `รหัสนักศึกษา ${normalizedStudentId} อยู่ในชั้นเรียนนี้แล้ว`
        });
      }

      db.prepare("INSERT INTO enrollments (user_id, class_id) VALUES (?, ?)")
        .run(student.id, classId);

      res.json({ student, enrolled: true });
    } catch (e) {
      res.status(400).json({ error: "ไม่สามารถเพิ่มนักเรียนเข้าชั้นเรียนได้" });
    }
  });

  app.post("/api/classes/:classId/students/:studentId/restore", async (req, res) => {
    const { classId, studentId } = req.params;
    const { actorId } = req.body;

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์กู้คืนนักเรียนในชั้นนี้" });
    }

    try {
      const student = db
        .prepare("SELECT * FROM users WHERE id = ? AND role = 'student'")
        .get(studentId);

      if (!student) {
        return res.status(404).json({ error: "ไม่พบข้อมูลนักเรียน" });
      }

      db.prepare("INSERT OR IGNORE INTO enrollments (user_id, class_id) VALUES (?, ?)")
        .run(studentId, classId);

      res.json({ success: true, student });
    } catch (e) {
      res.status(500).json({ error: "ไม่สามารถกู้คืนนักเรียนกลับเข้าชั้นเรียนได้" });
    }
  });

  app.get("/api/classes/:id/assignments", (req, res) => {
    const userId = req.query.userId;
    let assignments;
    if (userId) {
      assignments = db.prepare(`
        SELECT a.*, s.status as submission_status, s.grade, s.submitted_at 
        FROM assignments a
        LEFT JOIN submissions s ON a.id = s.assignment_id AND s.student_id = ?
        WHERE a.class_id = ?
      `).all(userId, req.params.id);
    } else {
      assignments = db.prepare("SELECT * FROM assignments WHERE class_id = ?").all(req.params.id);
    }
    res.json(assignments);
  });

  app.get("/api/classes/:id/leaderboard", async (req, res) => {
    const classId = Number(req.params.id);
    const userId = Number(req.query.userId || 0);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const classResult = await supabase
        .from("classes")
        .select("id")
        .eq("id", classId)
        .maybeSingle();

      if (classResult.error) {
        return res.status(500).json({ error: "Failed to load leaderboard" });
      }
      if (!classResult.data) {
        return res.status(404).json({ error: "Class not found" });
      }

      const scoreRowsResult = await supabase
        .from("leaderboard_scores")
        .select("class_id, user_id, score, streak, best_streak, updated_at")
        .eq("class_id", classId)
        .order("score", { ascending: false })
        .order("updated_at", { ascending: true });

      if (scoreRowsResult.error) {
        return res.status(500).json({ error: "Failed to load leaderboard" });
      }

      const scoreRows = scoreRowsResult.data || [];
      const userIds = scoreRows.map((row) => row.user_id).filter((id): id is number => Number.isFinite(id));

      let userById = new Map<number, any>();
      if (userIds.length > 0) {
        const usersResult = await supabase
          .from("users")
          .select("id, name, profile_picture")
          .in("id", userIds);

        if (usersResult.error) {
          return res.status(500).json({ error: "Failed to load leaderboard" });
        }

        userById = new Map((usersResult.data || []).map((u) => [u.id, u]));
      }

      const rankedEntries = scoreRows
        .map((row, index) => {
          const user = userById.get(row.user_id);
          if (!user) return null;
          return {
            user_id: row.user_id,
            name: user.name,
            profile_picture: user.profile_picture || null,
            score: Number(row.score || 0),
            streak: Number(row.streak || 0),
            best_streak: Number(row.best_streak || 0),
            rank: index + 1
          };
        })
        .filter((row): row is {
          user_id: number;
          name: string;
          profile_picture: string | null;
          score: number;
          streak: number;
          best_streak: number;
          rank: number;
        } => !!row);

      const myRank = Number.isFinite(userId) && userId > 0
        ? rankedEntries.find((entry) => entry.user_id === userId) || null
        : null;

      return res.json({
        classId,
        top3: rankedEntries.slice(0, 3),
        myRank,
        totalPlayers: rankedEntries.length
      });
    }

    const rankedEntries = db.prepare(`
      SELECT
        ls.user_id,
        u.name,
        u.profile_picture,
        ls.score,
        ls.streak,
        ls.best_streak,
        ls.updated_at
      FROM leaderboard_scores ls
      JOIN users u ON u.id = ls.user_id
      WHERE ls.class_id = ?
      ORDER BY ls.score DESC, ls.updated_at ASC
    `).all(classId) as Array<{
      user_id: number;
      name: string;
      profile_picture: string | null;
      score: number;
      streak: number;
      best_streak: number;
      updated_at: string;
    }>;

    const entries = rankedEntries.map((entry, index) => ({
      user_id: entry.user_id,
      name: entry.name,
      profile_picture: entry.profile_picture,
      score: Number(entry.score || 0),
      streak: Number(entry.streak || 0),
      best_streak: Number(entry.best_streak || 0),
      rank: index + 1
    }));

    const myRank = Number.isFinite(userId) && userId > 0
      ? entries.find((entry) => entry.user_id === userId) || null
      : null;

    return res.json({
      classId,
      top3: entries.slice(0, 3),
      myRank,
      totalPlayers: entries.length
    });
  });

  app.get("/api/classes/:id/games", async (req, res) => {
    const classId = Number(req.params.id);
    const userId = Number(req.query.userId || 0);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const classResult = await supabase
        .from("classes")
        .select("id, teacher_id")
        .eq("id", classId)
        .maybeSingle();

      if (classResult.error) {
        return res.status(500).json({ error: "Failed to fetch games" });
      }
      if (!classResult.data) {
        return res.status(404).json({ error: "Class not found" });
      }

      if (Number.isFinite(userId) && userId > 0) {
        const isOwner = classResult.data.teacher_id === userId;
        if (!isOwner) {
          const enrolledResult = await supabase
            .from("enrollments")
            .select("user_id")
            .eq("class_id", classId)
            .eq("user_id", userId)
            .limit(1);

          if (enrolledResult.error) {
            return res.status(500).json({ error: "Failed to fetch games" });
          }

          if (!enrolledResult.data || enrolledResult.data.length === 0) {
            return res.status(403).json({ error: "ไม่มีสิทธิ์ดูเกมของชั้นเรียนนี้" });
          }
        }
      }

      const gamesResult = await supabase
        .from("class_games")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: false });

      if (gamesResult.error) {
        return res.status(500).json({ error: "Failed to fetch games" });
      }

      return res.json(gamesResult.data || []);
    }

    if (Number.isFinite(userId) && userId > 0) {
      const classInfo = db.prepare("SELECT teacher_id FROM classes WHERE id = ?").get(classId) as { teacher_id: number | null } | undefined;
      if (!classInfo) {
        return res.status(404).json({ error: "Class not found" });
      }

      const isOwner = classInfo.teacher_id === userId;
      if (!isOwner) {
        const enrolled = db
          .prepare("SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?")
          .get(classId, userId);
        if (!enrolled) {
          return res.status(403).json({ error: "ไม่มีสิทธิ์ดูเกมของชั้นเรียนนี้" });
        }
      }
    }

    const games = db.prepare("SELECT * FROM class_games WHERE class_id = ? ORDER BY created_at DESC").all(classId);
    return res.json(games);
  });

  app.post("/api/classes/:id/games", async (req, res) => {
    const classId = Number(req.params.id);
    const { actorId, title, description, totalQuestions, timeLimitSec, questions } = req.body as {
      actorId?: number;
      title?: string;
      description?: string;
      totalQuestions?: number;
      timeLimitSec?: number;
      questions?: Array<{
        questionText?: string;
        choiceA?: string;
        choiceB?: string;
        choiceC?: string;
        choiceD?: string;
        correctChoice?: string;
      }>;
    };

    const teacherId = Number(actorId);
    if (!Number.isFinite(classId) || !Number.isFinite(teacherId)) {
      return res.status(400).json({ error: "Invalid class id or actor id" });
    }

    if (!(await isClassOwnerTeacher(classId, teacherId))) {
      return res.status(403).json({ error: "เฉพาะครูเจ้าของวิชาเท่านั้นที่สร้างเกมได้" });
    }

    const normalizedTitle = String(title || "").trim();
    const normalizedDescription = String(description || "").trim();
    const normalizedTotalQuestions = Math.max(1, Math.min(100, Number(totalQuestions || 10)));
    const normalizedTimeLimit = Math.max(5, Math.min(300, Number(timeLimitSec || 20)));

    if (!normalizedTitle) {
      return res.status(400).json({ error: "กรุณาระบุชื่อเกม" });
    }

    const normalizedQuestions = (Array.isArray(questions) ? questions : [])
      .map((item, index) => {
        const questionText = String(item.questionText || "").trim();
        const choiceA = String(item.choiceA || "").trim();
        const choiceB = String(item.choiceB || "").trim();
        const choiceC = String(item.choiceC || "").trim();
        const choiceD = String(item.choiceD || "").trim();
        const correctChoice = String(item.correctChoice || "A").trim().toUpperCase();
        return {
          class_id: classId,
          question_text: questionText,
          choice_a: choiceA,
          choice_b: choiceB,
          choice_c: choiceC,
          choice_d: choiceD,
          correct_choice: ["A", "B", "C", "D"].includes(correctChoice) ? correctChoice : "A",
          display_order: index + 1
        };
      })
      .filter((item) => item.question_text && item.choice_a && item.choice_b && item.choice_c && item.choice_d);

    const questionPayload = normalizedQuestions.length > 0
      ? normalizedQuestions
      : [
          {
            class_id: classId,
            question_text: `ข้อใดอธิบายแนวคิดหลักของ ${normalizedTitle} ได้ถูกต้องที่สุด?`,
            choice_a: "แนวทางที่ถูกต้องตามบทเรียน",
            choice_b: "ตัวเลือกที่ใกล้เคียงแต่ไม่ครบ",
            choice_c: "แนวคิดที่ไม่เกี่ยวข้อง",
            choice_d: "ตัวเลือกที่ผิดทั้งหมด",
            correct_choice: "A",
            display_order: 1
          }
        ];

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const created = await supabase
        .from("class_games")
        .insert({
          class_id: classId,
          title: normalizedTitle,
          description: normalizedDescription || null,
          total_questions: normalizedTotalQuestions,
          time_limit_sec: normalizedTimeLimit,
          is_active: false
        })
        .select("*")
        .single();

      if (created.error || !created.data) {
        return res.status(500).json({ error: "ไม่สามารถสร้างเกมได้" });
      }

      const questionRows = questionPayload.map((item) => ({ ...item, game_id: created.data.id }));
      const insertedQuestions = await supabase.from("class_game_questions").insert(questionRows);
      if (insertedQuestions.error) {
        return res.status(500).json({ error: "สร้างเกมสำเร็จแต่บันทึกคำถามไม่สำเร็จ" });
      }

      return res.json(created.data);
    }

    try {
      const info = db.prepare(`
        INSERT INTO class_games (class_id, title, description, total_questions, time_limit_sec, is_active)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run(classId, normalizedTitle, normalizedDescription || null, normalizedTotalQuestions, normalizedTimeLimit);

      const gameId = Number(info.lastInsertRowid);
      const insertQuestion = db.prepare(`
        INSERT INTO class_game_questions (
          class_id,
          game_id,
          question_text,
          choice_a,
          choice_b,
          choice_c,
          choice_d,
          correct_choice,
          display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      questionPayload.forEach((item) => {
        insertQuestion.run(
          item.class_id,
          gameId,
          item.question_text,
          item.choice_a,
          item.choice_b,
          item.choice_c,
          item.choice_d,
          item.correct_choice,
          item.display_order
        );
      });

      const game = db.prepare("SELECT * FROM class_games WHERE id = ?").get(gameId);
      return res.json(game);
    } catch (e) {
      return res.status(500).json({ error: "ไม่สามารถสร้างเกมได้" });
    }
  });

  app.get("/api/classes/:classId/games/:gameId(\\d+)", async (req, res) => {
    const classId = Number(req.params.classId);
    const gameId = Number(req.params.gameId);
    const actorId = Number(req.query.actorId || 0);

    if (!Number.isFinite(classId) || !Number.isFinite(gameId) || !Number.isFinite(actorId)) {
      return res.status(400).json({ error: "Invalid class id, game id or actor id" });
    }

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "เฉพาะครูเจ้าของวิชาเท่านั้นที่ดูรายละเอียดเกมได้" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const gameResult = await supabase
        .from("class_games")
        .select("*")
        .eq("id", gameId)
        .eq("class_id", classId)
        .maybeSingle();

      if (gameResult.error) {
        return res.status(500).json({ error: "ไม่สามารถโหลดรายละเอียดเกมได้" });
      }
      if (!gameResult.data) {
        return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
      }

      const questionsResult = await supabase
        .from("class_game_questions")
        .select("id, class_id, game_id, question_text, choice_a, choice_b, choice_c, choice_d, correct_choice, display_order")
        .eq("class_id", classId)
        .eq("game_id", gameId)
        .order("display_order", { ascending: true });

      if (questionsResult.error) {
        return res.status(500).json({ error: "ไม่สามารถโหลดคำถามเกมได้" });
      }

      return res.json({ game: gameResult.data, questions: questionsResult.data || [] });
    }

    const game = db.prepare("SELECT * FROM class_games WHERE id = ? AND class_id = ?").get(gameId, classId);
    if (!game) {
      return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
    }

    const questions = db.prepare(`
      SELECT id, class_id, game_id, question_text, choice_a, choice_b, choice_c, choice_d, correct_choice, display_order
      FROM class_game_questions
      WHERE class_id = ? AND game_id = ?
      ORDER BY display_order ASC
    `).all(classId, gameId);

    return res.json({ game, questions });
  });

  app.patch("/api/classes/:classId/games/:gameId(\\d+)", async (req, res) => {
    const classId = Number(req.params.classId);
    const gameId = Number(req.params.gameId);
    const { actorId, title, description, totalQuestions, timeLimitSec, questions } = req.body as {
      actorId?: number;
      title?: string;
      description?: string;
      totalQuestions?: number;
      timeLimitSec?: number;
      questions?: Array<{
        questionText?: string;
        choiceA?: string;
        choiceB?: string;
        choiceC?: string;
        choiceD?: string;
        correctChoice?: string;
      }>;
    };

    const teacherId = Number(actorId);
    if (!Number.isFinite(classId) || !Number.isFinite(gameId) || !Number.isFinite(teacherId)) {
      return res.status(400).json({ error: "Invalid class id, game id or actor id" });
    }

    if (!(await isClassOwnerTeacher(classId, teacherId))) {
      return res.status(403).json({ error: "เฉพาะครูเจ้าของวิชาเท่านั้นที่แก้ไขเกมได้" });
    }

    const normalizedTitle = String(title || "").trim();
    const normalizedDescription = String(description || "").trim();
    const normalizedTotalQuestions = Math.max(1, Math.min(100, Number(totalQuestions || 10)));
    const normalizedTimeLimit = Math.max(5, Math.min(300, Number(timeLimitSec || 20)));

    if (!normalizedTitle) {
      return res.status(400).json({ error: "กรุณาระบุชื่อเกม" });
    }

    const normalizedQuestions = (Array.isArray(questions) ? questions : [])
      .map((item, index) => {
        const questionText = String(item.questionText || "").trim();
        const choiceA = String(item.choiceA || "").trim();
        const choiceB = String(item.choiceB || "").trim();
        const choiceC = String(item.choiceC || "").trim();
        const choiceD = String(item.choiceD || "").trim();
        const correctChoice = String(item.correctChoice || "A").trim().toUpperCase();
        return {
          class_id: classId,
          question_text: questionText,
          choice_a: choiceA,
          choice_b: choiceB,
          choice_c: choiceC,
          choice_d: choiceD,
          correct_choice: ["A", "B", "C", "D"].includes(correctChoice) ? correctChoice : "A",
          display_order: index + 1
        };
      })
      .filter((item) => item.question_text && item.choice_a && item.choice_b && item.choice_c && item.choice_d);

    const hasQuestionPayload = Array.isArray(questions);
    if (hasQuestionPayload && normalizedQuestions.length === 0) {
      return res.status(400).json({ error: "กรุณาระบุคำถามอย่างน้อย 1 ข้อ" });
    }

    const normalizedQuestionCount = hasQuestionPayload
      ? normalizedQuestions.length
      : normalizedTotalQuestions;

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const gameResult = await supabase
        .from("class_games")
        .select("id")
        .eq("id", gameId)
        .eq("class_id", classId)
        .maybeSingle();

      if (gameResult.error) {
        return res.status(500).json({ error: "ไม่สามารถแก้ไขเกมได้" });
      }
      if (!gameResult.data) {
        return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
      }

      const updated = await supabase
        .from("class_games")
        .update({
          title: normalizedTitle,
          description: normalizedDescription || null,
          total_questions: normalizedQuestionCount,
          time_limit_sec: normalizedTimeLimit
        })
        .eq("id", gameId)
        .eq("class_id", classId)
        .select("*")
        .single();

      if (updated.error || !updated.data) {
        return res.status(500).json({ error: "ไม่สามารถแก้ไขเกมได้" });
      }

      if (hasQuestionPayload) {
        const deleteQuestions = await supabase
          .from("class_game_questions")
          .delete()
          .eq("class_id", classId)
          .eq("game_id", gameId);

        if (deleteQuestions.error) {
          return res.status(500).json({ error: "ไม่สามารถลบคำถามเดิมของเกมได้" });
        }

        const insertPayload = normalizedQuestions.map((item) => ({ ...item, game_id: gameId }));
        const insertQuestions = await supabase
          .from("class_game_questions")
          .insert(insertPayload);

        if (insertQuestions.error) {
          return res.status(500).json({ error: "ไม่สามารถบันทึกคำถามเกมที่แก้ไขได้" });
        }
      }

      return res.json(updated.data);
    }

    const game = db.prepare("SELECT id FROM class_games WHERE id = ? AND class_id = ?").get(gameId, classId);
    if (!game) {
      return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
    }

    db.prepare(`
      UPDATE class_games
      SET title = ?, description = ?, total_questions = ?, time_limit_sec = ?
      WHERE id = ? AND class_id = ?
    `).run(normalizedTitle, normalizedDescription || null, normalizedQuestionCount, normalizedTimeLimit, gameId, classId);

    if (hasQuestionPayload) {
      db.prepare("DELETE FROM class_game_questions WHERE class_id = ? AND game_id = ?").run(classId, gameId);
      const insertQuestion = db.prepare(`
        INSERT INTO class_game_questions (
          class_id,
          game_id,
          question_text,
          choice_a,
          choice_b,
          choice_c,
          choice_d,
          correct_choice,
          display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      normalizedQuestions.forEach((item) => {
        insertQuestion.run(
          item.class_id,
          gameId,
          item.question_text,
          item.choice_a,
          item.choice_b,
          item.choice_c,
          item.choice_d,
          item.correct_choice,
          item.display_order
        );
      });
    }

    const updated = db.prepare("SELECT * FROM class_games WHERE id = ?").get(gameId);
    return res.json(updated);
  });

  app.delete("/api/classes/:classId/games/:gameId(\\d+)", async (req, res) => {
    const classId = Number(req.params.classId);
    const gameId = Number(req.params.gameId);
    const actorId = Number(req.query.actorId || 0);

    if (!Number.isFinite(classId) || !Number.isFinite(gameId) || !Number.isFinite(actorId)) {
      return res.status(400).json({ error: "Invalid class id, game id or actor id" });
    }

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "เฉพาะครูเจ้าของวิชาเท่านั้นที่ลบเกมได้" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const gameResult = await supabase
        .from("class_games")
        .select("id")
        .eq("id", gameId)
        .eq("class_id", classId)
        .maybeSingle();

      if (gameResult.error) {
        return res.status(500).json({ error: "ไม่สามารถลบเกมได้" });
      }
      if (!gameResult.data) {
        return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
      }

      const deleteQuestions = await supabase
        .from("class_game_questions")
        .delete()
        .eq("class_id", classId)
        .eq("game_id", gameId);

      if (deleteQuestions.error) {
        return res.status(500).json({ error: "ไม่สามารถลบคำถามของเกมได้" });
      }

      const deleteGame = await supabase
        .from("class_games")
        .delete()
        .eq("id", gameId)
        .eq("class_id", classId);

      if (deleteGame.error) {
        return res.status(500).json({ error: "ไม่สามารถลบเกมได้" });
      }

      return res.json({ success: true });
    }

    const game = db.prepare("SELECT id FROM class_games WHERE id = ? AND class_id = ?").get(gameId, classId);
    if (!game) {
      return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
    }

    db.prepare("DELETE FROM class_game_questions WHERE class_id = ? AND game_id = ?").run(classId, gameId);
    db.prepare("DELETE FROM class_games WHERE id = ? AND class_id = ?").run(gameId, classId);
    return res.json({ success: true });
  });

  app.patch("/api/classes/:classId/games/:gameId(\\d+)/active", async (req, res) => {
    const classId = Number(req.params.classId);
    const gameId = Number(req.params.gameId);
    const { actorId, isActive } = req.body as { actorId?: number; isActive?: boolean };

    const teacherId = Number(actorId);
    if (!Number.isFinite(classId) || !Number.isFinite(gameId) || !Number.isFinite(teacherId)) {
      return res.status(400).json({ error: "Invalid class id, game id or actor id" });
    }

    if (!(await isClassOwnerTeacher(classId, teacherId))) {
      return res.status(403).json({ error: "เฉพาะครูเจ้าของวิชาเท่านั้นที่เปิด/ปิดเกมได้" });
    }

    const nextActive = !!isActive;

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const gameResult = await supabase
        .from("class_games")
        .select("id")
        .eq("id", gameId)
        .eq("class_id", classId)
        .maybeSingle();

      if (gameResult.error) {
        return res.status(500).json({ error: "ไม่สามารถอัปเดตสถานะเกมได้" });
      }
      if (!gameResult.data) {
        return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
      }

      if (nextActive) {
        await supabase.from("class_games").update({ is_active: false }).eq("class_id", classId);
      }

      const updated = await supabase
        .from("class_games")
        .update({ is_active: nextActive })
        .eq("id", gameId)
        .eq("class_id", classId)
        .select("*")
        .single();

      if (updated.error || !updated.data) {
        return res.status(500).json({ error: "ไม่สามารถอัปเดตสถานะเกมได้" });
      }

      return res.json(updated.data);
    }

    const game = db.prepare("SELECT id FROM class_games WHERE id = ? AND class_id = ?").get(gameId, classId);
    if (!game) {
      return res.status(404).json({ error: "ไม่พบเกมในวิชานี้" });
    }

    if (nextActive) {
      db.prepare("UPDATE class_games SET is_active = 0 WHERE class_id = ?").run(classId);
    }

    db.prepare("UPDATE class_games SET is_active = ? WHERE id = ? AND class_id = ?")
      .run(nextActive ? 1 : 0, gameId, classId);

    const updated = db.prepare("SELECT * FROM class_games WHERE id = ?").get(gameId);
    return res.json(updated);
  });

  app.get("/api/classes/:classId/games/active", async (req, res) => {
    const classId = Number(req.params.classId);
    const userId = Number(req.query.userId || 0);

    if (!Number.isFinite(classId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "Invalid class id or user id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const classResult = await supabase
        .from("classes")
        .select("teacher_id")
        .eq("id", classId)
        .maybeSingle();

      if (classResult.error || !classResult.data) {
        return res.status(404).json({ error: "Class not found" });
      }

      if (classResult.data.teacher_id !== userId) {
        const enrolled = await supabase
          .from("enrollments")
          .select("user_id")
          .eq("class_id", classId)
          .eq("user_id", userId)
          .limit(1);
        if (enrolled.error || !enrolled.data || enrolled.data.length === 0) {
          return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงเกมของวิชานี้" });
        }
      }

      const gameResult = await supabase
        .from("class_games")
        .select("*")
        .eq("class_id", classId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (gameResult.error) {
        return res.status(500).json({ error: "ไม่สามารถโหลดเกมได้" });
      }
      if (!gameResult.data) {
        return res.json({ game: null, questions: [] });
      }

      const questionsResult = await supabase
        .from("class_game_questions")
        .select("id, question_text, choice_a, choice_b, choice_c, choice_d, display_order")
        .eq("class_id", classId)
        .eq("game_id", gameResult.data.id)
        .order("display_order", { ascending: true });

      if (questionsResult.error) {
        return res.status(500).json({ error: "ไม่สามารถโหลดคำถามเกมได้" });
      }

      return res.json({ game: gameResult.data, questions: questionsResult.data || [] });
    }

    const classInfo = db.prepare("SELECT teacher_id FROM classes WHERE id = ?").get(classId) as { teacher_id: number | null } | undefined;
    if (!classInfo) {
      return res.status(404).json({ error: "Class not found" });
    }

    if (classInfo.teacher_id !== userId) {
      const enrolled = db.prepare("SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?").get(classId, userId);
      if (!enrolled) {
        return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงเกมของวิชานี้" });
      }
    }

    const game = db.prepare("SELECT * FROM class_games WHERE class_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1").get(classId);
    if (!game) {
      return res.json({ game: null, questions: [] });
    }

    const questions = db.prepare(`
      SELECT id, question_text, choice_a, choice_b, choice_c, choice_d, display_order
      FROM class_game_questions
      WHERE class_id = ? AND game_id = ?
      ORDER BY display_order ASC
    `).all(classId, (game as any).id);

    return res.json({ game, questions });
  });

  app.post("/api/classes/:classId/games/:gameId(\\d+)/answer", async (req, res) => {
    const classId = Number(req.params.classId);
    const gameId = Number(req.params.gameId);
    const { userId, questionId, choice } = req.body as { userId?: number; questionId?: number; choice?: string };

    const actorId = Number(userId);
    const qId = Number(questionId);
    const selectedChoice = String(choice || "").trim().toUpperCase();

    if (!Number.isFinite(classId) || !Number.isFinite(gameId) || !Number.isFinite(actorId) || !Number.isFinite(qId)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    if (!["A", "B", "C", "D"].includes(selectedChoice)) {
      return res.status(400).json({ error: "ตัวเลือกคำตอบไม่ถูกต้อง" });
    }

    let question: { correct_choice: string } | null = null;

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const enrolled = await supabase
        .from("enrollments")
        .select("user_id")
        .eq("class_id", classId)
        .eq("user_id", actorId)
        .limit(1);

      if (enrolled.error || !enrolled.data || enrolled.data.length === 0) {
        return res.status(403).json({ error: "เฉพาะนักเรียนในชั้นเรียนนี้เท่านั้น" });
      }

      const activeGame = await supabase
        .from("class_games")
        .select("id")
        .eq("id", gameId)
        .eq("class_id", classId)
        .eq("is_active", true)
        .maybeSingle();

      if (activeGame.error || !activeGame.data) {
        return res.status(400).json({ error: "เกมนี้ยังไม่เปิดให้เล่น" });
      }

      const questionResult = await supabase
        .from("class_game_questions")
        .select("correct_choice")
        .eq("class_id", classId)
        .eq("game_id", gameId)
        .eq("id", qId)
        .maybeSingle();

      if (questionResult.error || !questionResult.data) {
        return res.status(404).json({ error: "ไม่พบคำถาม" });
      }

      question = { correct_choice: questionResult.data.correct_choice };
    } else {
      const enrolled = db.prepare("SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?").get(classId, actorId);
      if (!enrolled) {
        return res.status(403).json({ error: "เฉพาะนักเรียนในชั้นเรียนนี้เท่านั้น" });
      }

      const activeGame = db
        .prepare("SELECT id FROM class_games WHERE id = ? AND class_id = ? AND is_active = 1")
        .get(gameId, classId);
      if (!activeGame) {
        return res.status(400).json({ error: "เกมนี้ยังไม่เปิดให้เล่น" });
      }

      const questionResult = db
        .prepare("SELECT correct_choice FROM class_game_questions WHERE id = ? AND game_id = ? AND class_id = ?")
        .get(qId, gameId, classId) as { correct_choice: string } | undefined;

      if (!questionResult) {
        return res.status(404).json({ error: "ไม่พบคำถาม" });
      }

      question = questionResult;
    }

    const isCorrect = question.correct_choice.toUpperCase() === selectedChoice;
    const deltaPoints = isCorrect ? 10 : -5;
    const scoreResult = await updateLeaderboardScore(classId, actorId, deltaPoints);

    if (scoreResult.error) {
      return res.status(scoreResult.error.includes("เฉพาะนักเรียน") ? 403 : 500).json({ error: scoreResult.error });
    }

    return res.json({
      correct: isCorrect,
      correctChoice: question.correct_choice,
      points: deltaPoints,
      score: scoreResult.data
    });
  });

  app.post("/api/classes/:id/leaderboard/score", async (req, res) => {
    const classId = Number(req.params.id);
    const { userId, points } = req.body as { userId?: number; points?: number };
    const actorId = Number(userId);
    const deltaPoints = Number(points || 0);

    const scoreResult = await updateLeaderboardScore(classId, actorId, deltaPoints);
    if (scoreResult.error) {
      const isForbidden = scoreResult.error.includes("เฉพาะนักเรียน");
      const isBadRequest = scoreResult.error.includes("Points") || scoreResult.error.includes("Invalid");
      return res.status(isForbidden ? 403 : isBadRequest ? 400 : 500).json({ error: scoreResult.error });
    }

    return res.json(scoreResult.data);
  });

  app.get("/api/classes/:id/attendance", async (req, res) => {
    const classId = Number(req.params.id);
    const date = String(req.query.date || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD" });
    }

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      try {
        const result = await supabase
          .from("attendance_records")
          .select("student_id, attendance_date, status, checked_at")
          .eq("class_id", classId)
          .eq("attendance_date", date);

        if (result.error) {
          return res.status(500).json({ error: "ไม่สามารถดึงข้อมูลการเช็คชื่อได้" });
        }

        return res.json({ date, records: result.data || [] });
      } catch (e) {
        return res.status(500).json({ error: "ไม่สามารถดึงข้อมูลการเช็คชื่อได้" });
      }
    }

    try {
      const records = db.prepare(`
        SELECT student_id, attendance_date, status, checked_at
        FROM attendance_records
        WHERE class_id = ? AND attendance_date = ?
      `).all(classId, date);

      res.json({ date, records });
    } catch (e) {
      res.status(500).json({ error: "ไม่สามารถดึงข้อมูลการเช็คชื่อได้" });
    }
  });

  app.post("/api/classes/:id/attendance", async (req, res) => {
    const classId = Number(req.params.id);
    const { actorId, date, records } = req.body as {
      actorId?: number;
      date?: string;
      records?: Array<{ studentId?: number; status?: string }>;
    };

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์เช็คชื่อในชั้นนี้" });
    }

    const normalizedDate = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ error: "กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD" });
    }

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "ไม่พบข้อมูลการเช็คชื่อที่ต้องบันทึก" });
    }

    const allowedStatus = new Set(["present", "late", "absent"]);

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const enrollmentResult = await supabase
        .from("enrollments")
        .select("user_id")
        .eq("class_id", classId);

      if (enrollmentResult.error) {
        return res.status(500).json({ error: "ไม่สามารถตรวจสอบรายชื่อนักเรียนได้" });
      }

      const enrollmentIds = new Set((enrollmentResult.data || []).map((item) => Number(item.user_id)));

      for (const item of records) {
        if (!item.studentId || !enrollmentIds.has(Number(item.studentId))) {
          return res.status(400).json({ error: "พบนักเรียนที่ไม่อยู่ในชั้นเรียนนี้" });
        }
        if (!item.status || !allowedStatus.has(item.status)) {
          return res.status(400).json({ error: "สถานะเช็คชื่อไม่ถูกต้อง" });
        }
      }

      try {
        const payload = records.map((item) => ({
          class_id: classId,
          student_id: Number(item.studentId),
          attendance_date: normalizedDate,
          status: item.status,
          checked_by: actorId,
          checked_at: new Date().toISOString(),
        }));

        const upsertResult = await supabase
          .from("attendance_records")
          .upsert(payload, { onConflict: "class_id,student_id,attendance_date" });

        if (upsertResult.error) {
          return res.status(500).json({ error: "ไม่สามารถบันทึกข้อมูลการเช็คชื่อได้" });
        }

        return res.json({ success: true, count: payload.length, date: normalizedDate });
      } catch (e) {
        return res.status(500).json({ error: "ไม่สามารถบันทึกข้อมูลการเช็คชื่อได้" });
      }
    }

    const enrollmentIds = new Set(
      (db.prepare("SELECT user_id FROM enrollments WHERE class_id = ?").all(classId) as Array<{ user_id: number }>).map((item) => item.user_id)
    );

    for (const item of records) {
      if (!item.studentId || !enrollmentIds.has(Number(item.studentId))) {
        return res.status(400).json({ error: "พบนักเรียนที่ไม่อยู่ในชั้นเรียนนี้" });
      }
      if (!item.status || !allowedStatus.has(item.status)) {
        return res.status(400).json({ error: "สถานะเช็คชื่อไม่ถูกต้อง" });
      }
    }

    try {
      const upsert = db.prepare(`
        INSERT INTO attendance_records (class_id, student_id, attendance_date, status, checked_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(class_id, student_id, attendance_date)
        DO UPDATE SET status = excluded.status, checked_by = excluded.checked_by, checked_at = CURRENT_TIMESTAMP
      `);

      const trx = db.transaction((items: Array<{ studentId?: number; status?: string }>) => {
        items.forEach((item) => {
          upsert.run(classId, item.studentId, normalizedDate, item.status, actorId);
        });
      });

      trx(records);
      res.json({ success: true, count: records.length, date: normalizedDate });
    } catch (e) {
      res.status(500).json({ error: "ไม่สามารถบันทึกข้อมูลการเช็คชื่อได้" });
    }
  });

  app.get("/api/classes/:id/attendance/monthly", async (req, res) => {
    const classId = Number(req.params.id);
    const month = String(req.query.month || '').trim();
    const actorId = Number(req.query.actorId || 0);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ดูรายงานเช็คชื่อของชั้นนี้" });
    }

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "กรุณาระบุเดือนในรูปแบบ YYYY-MM" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      try {
        const enrollmentsResult = await supabase
          .from("enrollments")
          .select("user_id, users(id, name, student_id, role)")
          .eq("class_id", classId);

        if (enrollmentsResult.error) {
          return res.status(500).json({ error: "ไม่สามารถดึงรายงานเช็คชื่อรายเดือนได้" });
        }

        const students = (enrollmentsResult.data || [])
          .map((row: any) => row.users)
          .filter((user: any) => user && user.role === "student");

        const monthStart = `${month}-01`;
        const nextMonthDate = new Date(`${month}-01T00:00:00.000Z`);
        nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
        const monthEnd = nextMonthDate.toISOString().slice(0, 10);

        const studentIds = students.map((student: any) => Number(student.id));
        let attendanceRows: Array<{ student_id: number; status: string }> = [];
        if (studentIds.length > 0) {
          const attendanceResult = await supabase
            .from("attendance_records")
            .select("student_id, status")
            .eq("class_id", classId)
            .gte("attendance_date", monthStart)
            .lt("attendance_date", monthEnd)
            .in("student_id", studentIds);

          if (attendanceResult.error) {
            return res.status(500).json({ error: "ไม่สามารถดึงรายงานเช็คชื่อรายเดือนได้" });
          }

          attendanceRows = (attendanceResult.data || []) as Array<{ student_id: number; status: string }>;
        }

        const summaryMap = new Map<number, {
          student_id: number;
          student_name: string;
          student_code?: string;
          present_count: number;
          late_count: number;
          absent_count: number;
          checked_count: number;
        }>();
        students.forEach((student: any) => {
          summaryMap.set(Number(student.id), {
            student_id: Number(student.id),
            student_name: student.name,
            student_code: student.student_id || undefined,
            present_count: 0,
            late_count: 0,
            absent_count: 0,
            checked_count: 0,
          });
        });

        attendanceRows.forEach((row) => {
          const summary = summaryMap.get(Number(row.student_id));
          if (!summary) return;
          summary.checked_count += 1;
          if (row.status === "present") summary.present_count += 1;
          if (row.status === "late") summary.late_count += 1;
          if (row.status === "absent") summary.absent_count += 1;
        });

        const rows = Array.from(summaryMap.values()).sort((a, b) => a.student_name.localeCompare(b.student_name, "th"));
        return res.json({ month, rows });
      } catch (e) {
        return res.status(500).json({ error: "ไม่สามารถดึงรายงานเช็คชื่อรายเดือนได้" });
      }
    }

    try {
      const rows = db.prepare(`
        SELECT
          u.id AS student_id,
          u.name AS student_name,
          u.student_id AS student_code,
          COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0) AS present_count,
          COALESCE(SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END), 0) AS late_count,
          COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent_count,
          COALESCE(COUNT(ar.id), 0) AS checked_count
        FROM users u
        JOIN enrollments e ON e.user_id = u.id AND e.class_id = ?
        LEFT JOIN attendance_records ar
          ON ar.class_id = ?
          AND ar.student_id = u.id
          AND substr(ar.attendance_date, 1, 7) = ?
        WHERE u.role = 'student'
        GROUP BY u.id, u.name, u.student_id
        ORDER BY u.name ASC
      `).all(classId, classId, month);

      res.json({ month, rows });
    } catch (e) {
      res.status(500).json({ error: "ไม่สามารถดึงรายงานเช็คชื่อรายเดือนได้" });
    }
  });

  app.get("/api/classes/:id/vibe-dashboard", async (req, res) => {
    const classId = Number(req.params.id);
    const actorId = Number(req.query.actorId || 0);
    const month = String(req.query.month || '').trim() || new Date().toISOString().slice(0, 7);

    if (!Number.isFinite(classId)) return res.status(400).json({ error: "Invalid class id" });
    if (!(await isClassOwnerTeacher(classId, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });
      try {
        const today = new Date().toISOString().slice(0, 10);
        const recentDueDateFloor = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

        const { data: enrollments } = await supabase
          .from("enrollments")
          .select("user_id, users(id, name, profile_picture)")
          .eq("class_id", classId);

        const studentIds: number[] = (enrollments || []).map((e: any) => e.user_id);
        const studentNameMap: Record<number, string> = {};
        (enrollments || []).forEach((e: any) => {
          if (e.users) studentNameMap[e.user_id] = e.users.name || `Student ${e.user_id}`;
        });

        const { data: assignments } = await supabase
          .from("assignments")
          .select("id, title, due_date")
          .eq("class_id", classId);

        const allAssignmentIds = (assignments || []).map((a: any) => a.id);
        const overdueAssignmentIds = (assignments || [])
          .filter((a: any) => a.due_date && a.due_date < today && a.due_date >= recentDueDateFloor)
          .map((a: any) => a.id);

        const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

        let allSubmissions: any[] = [];
        if (allAssignmentIds.length > 0 && studentIds.length > 0) {
          const { data: subs } = await supabase
            .from("submissions")
            .select("assignment_id, student_id, submitted_at")
            .in("assignment_id", allAssignmentIds)
            .in("student_id", studentIds)
            .order("submitted_at", { ascending: false });
          allSubmissions = subs || [];
        }

        // Late students: enrolled students missing overdue assignments
        const lateStudentMap: Record<number, { student_id: number; name: string; overdue_count: number }> = {};
        if (overdueAssignmentIds.length > 0 && studentIds.length > 0) {
          const submittedSet = new Set(
            allSubmissions
              .filter((s: any) => overdueAssignmentIds.includes(s.assignment_id))
              .map((s: any) => `${s.assignment_id}:${s.student_id}`)
          );
          for (const assignId of overdueAssignmentIds) {
            for (const sid of studentIds) {
              if (!submittedSet.has(`${assignId}:${sid}`)) {
                if (!lateStudentMap[sid]) lateStudentMap[sid] = { student_id: sid, name: studentNameMap[sid] || `Student ${sid}`, overdue_count: 0 };
                lateStudentMap[sid].overdue_count++;
              }
            }
          }
        }
        const lateStudents = Object.values(lateStudentMap)
          .sort((a, b) => b.overdue_count - a.overdue_count)
          .slice(0, 10);

        // Recent submissions
        const recentSubmissions = allSubmissions
          .filter((s: any) => s.submitted_at >= cutoff48h)
          .slice(0, 10)
          .map((s: any) => ({
            student_id: s.student_id,
            name: studentNameMap[s.student_id] || `Student ${s.student_id}`,
            submitted_at: s.submitted_at,
            assignment_title: (assignments || []).find((a: any) => a.id === s.assignment_id)?.title || '',
          }));

        // Top scorers
        const { data: scores } = await supabase
          .from("leaderboard_scores")
          .select("user_id, score, users(name, profile_picture)")
          .eq("class_id", classId)
          .order("score", { ascending: false })
          .limit(5);

        const topScorers = (scores || []).map((s: any, i: number) => ({
          user_id: s.user_id,
          name: (s.users as any)?.name || `Student ${s.user_id}`,
          profile_picture: (s.users as any)?.profile_picture || null,
          score: s.score,
          rank: i + 1,
        }));

        // Low attendance this month
        const monthStart = `${month}-01`;
        const nextMonthDate = new Date(month + '-01');
        nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
        const monthEnd = nextMonthDate.toISOString().slice(0, 10);

        let attendanceRows: any[] = [];
        if (studentIds.length > 0) {
          const { data: attRows } = await supabase
            .from("attendance_records")
            .select("student_id, status")
            .eq("class_id", classId)
            .gte("attendance_date", monthStart)
            .lt("attendance_date", monthEnd)
            .in("student_id", studentIds);
          attendanceRows = attRows || [];
        }

        const attendanceByStudent: Record<number, { checked: number; attended: number; absent: number }> = {};
        attendanceRows.forEach((ar: any) => {
          if (!attendanceByStudent[ar.student_id]) attendanceByStudent[ar.student_id] = { checked: 0, attended: 0, absent: 0 };
          attendanceByStudent[ar.student_id].checked++;
          if (ar.status === 'present' || ar.status === 'late') attendanceByStudent[ar.student_id].attended++;
          if (ar.status === 'absent') attendanceByStudent[ar.student_id].absent++;
        });

        const lowAttendance = Object.entries(attendanceByStudent)
          .filter(([, v]) => v.checked > 0 && v.absent > 0)
          .map(([sid, v]) => ({
            student_id: Number(sid),
            name: studentNameMap[Number(sid)] || `Student ${sid}`,
            absent_count: v.absent,
            attendance_rate: Math.round(v.attended / v.checked * 100),
          }))
          .sort((a, b) => {
            if (b.absent_count !== a.absent_count) return b.absent_count - a.absent_count;
            return a.attendance_rate - b.attendance_rate;
          });

        return res.json({ lateStudents, recentSubmissions, topScorers, lowAttendance });
      } catch (e) {
        return res.status(500).json({ error: "ไม่สามารถดึงข้อมูล vibe dashboard ได้" });
      }
    } else {
      // SQLite path
      try {
        const lateStudents = db.prepare(`
          SELECT u.id AS student_id, u.name, COUNT(*) AS overdue_count
          FROM users u
          JOIN enrollments e ON e.user_id = u.id AND e.class_id = ?
          JOIN assignments a ON a.class_id = ? AND a.due_date < date('now') AND a.due_date >= date('now', '-30 day')
          LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = u.id
          WHERE u.role = 'student' AND s.id IS NULL
          GROUP BY u.id, u.name
          ORDER BY overdue_count DESC
          LIMIT 10
        `).all(classId, classId);

        const recentSubmissions = db.prepare(`
          SELECT s.submitted_at, u.id AS student_id, u.name, a.title AS assignment_title
          FROM submissions s
          JOIN users u ON u.id = s.student_id
          JOIN assignments a ON a.id = s.assignment_id
          WHERE a.class_id = ? AND s.submitted_at >= datetime('now', '-48 hours')
          ORDER BY s.submitted_at DESC
          LIMIT 10
        `).all(classId);

        const topScorersRaw = db.prepare(`
          SELECT ls.user_id, u.name, u.profile_picture, ls.score
          FROM leaderboard_scores ls
          JOIN users u ON u.id = ls.user_id
          WHERE ls.class_id = ?
          ORDER BY ls.score DESC
          LIMIT 5
        `).all(classId);
        const topScorers = (topScorersRaw as any[]).map((s, i) => ({ ...s, rank: i + 1 }));

        const lowAttRaw = db.prepare(`
          SELECT u.id AS student_id, u.name,
            COALESCE(COUNT(ar.id), 0) AS checked_count,
            COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent_count,
            COALESCE(SUM(CASE WHEN ar.status IN ('present', 'late') THEN 1 ELSE 0 END), 0) AS attended_count
          FROM users u
          JOIN enrollments e ON e.user_id = u.id AND e.class_id = ?
          LEFT JOIN attendance_records ar ON ar.class_id = ? AND ar.student_id = u.id
            AND substr(ar.attendance_date, 1, 7) = ?
          WHERE u.role = 'student'
          GROUP BY u.id, u.name
          HAVING checked_count > 0 AND absent_count > 0
          ORDER BY absent_count DESC, attended_count * 1.0 / checked_count ASC
        `).all(classId, classId, month);

        const lowAttendance = (lowAttRaw as any[]).map(r => ({
          student_id: r.student_id,
          name: r.name,
          absent_count: r.absent_count,
          attendance_rate: Math.round(r.attended_count / r.checked_count * 100),
        }));

        return res.json({ lateStudents, recentSubmissions, topScorers, lowAttendance });
      } catch (e) {
        return res.status(500).json({ error: "ไม่สามารถดึงข้อมูล vibe dashboard ได้" });
      }
    }
  });

  app.post("/api/assignments", (req, res) => {
    const { classId, title, description, dueDate } = req.body;
    const info = db.prepare("INSERT INTO assignments (class_id, title, description, due_date) VALUES (?, ?, ?, ?)").run(classId, title, description, dueDate);
    
    broadcastToClass(classId, {
      type: "notification",
      title: "มีงานใหม่!",
      message: `คุณครูได้โพสต์งานใหม่: "${title}"`,
      classId
    });

    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/classes/:id/announcements", async (req, res) => {
    const classId = Number(req.params.id);
    const includeScheduled = String(req.query.includeScheduled || "0") === "1";
    const actorId = Number(req.query.actorId || 0);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      if (includeScheduled && !(await isClassOwnerTeacher(classId, actorId))) {
        return res.status(403).json({ error: "ไม่มีสิทธิ์ดูประกาศที่ตั้งเวลาไว้" });
      }

      let query = supabase
        .from("announcements")
        .select("id, class_id, content, created_at")
        .eq("class_id", classId)
        .order("created_at", { ascending: false });

      if (!includeScheduled) {
        query = query.lte("created_at", new Date().toISOString());
      }

      const result = await query;
      if (result.error) {
        return res.status(500).json({ error: "ไม่สามารถดึงประกาศได้" });
      }

      const nowTime = Date.now();
      const rows = (result.data || []).map((row) => {
        const createdAt = String(row.created_at || "");
        const createdAtMillis = createdAt ? new Date(createdAt).getTime() : 0;
        const isScheduled = Number.isFinite(createdAtMillis) && createdAtMillis > nowTime;

        return {
          ...row,
          publish_at: isScheduled ? createdAt : null
        };
      });

      return res.json(rows);
    }

    if (includeScheduled) {
      if (!(await isClassOwnerTeacher(classId, actorId))) {
        return res.status(403).json({ error: "ไม่มีสิทธิ์ดูประกาศที่ตั้งเวลาไว้" });
      }

      const announcements = db
        .prepare(`
          SELECT *
          FROM announcements
          WHERE class_id = ?
          ORDER BY COALESCE(publish_at, created_at) DESC, created_at DESC
        `)
        .all(classId);
      return res.json(announcements);
    }

    const announcements = db
      .prepare(`
        SELECT *
        FROM announcements
        WHERE class_id = ?
          AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))
        ORDER BY COALESCE(publish_at, created_at) DESC, created_at DESC
      `)
      .all(classId);
    return res.json(announcements);
  });

  app.post("/api/announcements", (req, res) => {
    const { classId, content, publishAt } = req.body;
    const parsedPublishAt = publishAt ? new Date(String(publishAt)) : null;

    if (parsedPublishAt && Number.isNaN(parsedPublishAt.getTime())) {
      return res.status(400).json({ error: "รูปแบบเวลาที่ตั้งโพสต์ไม่ถูกต้อง" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const createdAtValue = parsedPublishAt ? parsedPublishAt.toISOString() : new Date().toISOString();
      supabase
        .from("announcements")
        .insert({ class_id: classId, content, created_at: createdAtValue })
        .select("id, created_at")
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            return res.status(500).json({ error: "ไม่สามารถโพสต์ประกาศได้" });
          }

          return res.json({
            id: data.id,
            publish_at: parsedPublishAt ? String(data.created_at) : null
          });
        });
      return;
    }

    const publishAtValue = parsedPublishAt
      ? parsedPublishAt.toISOString().slice(0, 19).replace("T", " ")
      : null;
    const info = db
      .prepare("INSERT INTO announcements (class_id, content, publish_at) VALUES (?, ?, ?)")
      .run(classId, content, publishAtValue);

    res.json({ id: info.lastInsertRowid, publish_at: publishAtValue });
  });

  app.delete("/api/announcements/:id", async (req, res) => {
    const announcementId = Number(req.params.id);
    const actorId = Number(req.query.actorId || req.body?.actorId || 0);

    if (!Number.isFinite(announcementId) || !Number.isFinite(actorId)) {
      return res.status(400).json({ error: "Invalid announcement id or actor id" });
    }

    if (dbProvider === "supabase") {
      if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

      const announcementResult = await supabase
        .from("announcements")
        .select("id, class_id")
        .eq("id", announcementId)
        .maybeSingle();

      if (announcementResult.error || !announcementResult.data) {
        return res.status(404).json({ error: "ไม่พบประกาศ" });
      }

      if (!(await isClassOwnerTeacher(announcementResult.data.class_id, actorId))) {
        return res.status(403).json({ error: "ไม่มีสิทธิ์ลบประกาศนี้" });
      }

      const deleted = await supabase.from("announcements").delete().eq("id", announcementId);
      if (deleted.error) {
        return res.status(500).json({ error: "ไม่สามารถลบประกาศได้" });
      }

      return res.json({ ok: true });
    }

    const announcement = db
      .prepare("SELECT id, class_id FROM announcements WHERE id = ?")
      .get(announcementId) as { id: number; class_id: number } | undefined;

    if (!announcement) {
      return res.status(404).json({ error: "ไม่พบประกาศ" });
    }

    if (!(await isClassOwnerTeacher(announcement.class_id, actorId))) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ลบประกาศนี้" });
    }

    db.prepare("DELETE FROM announcements WHERE id = ?").run(announcementId);
    return res.json({ ok: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer, path: "/__vite_hmr" }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Database provider: ${dbProvider}`);
    if (supabase) {
      console.log("Supabase client initialized");
    }
  });
}

startServer();
