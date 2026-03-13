export interface User {
  id: number;
  student_id?: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'teacher' | 'student';
  profile_picture?: string;
  contact_info?: string;
  bio?: string;
}

export interface Classroom {
  id: number;
  name: string;
  description: string;
  teacher_id: number;
  code: string;
}

export interface Assignment {
  id: number;
  class_id: number;
  title: string;
  description: string;
  due_date: string;
  submission_status?: 'pending' | 'graded';
  grade?: string;
  submitted_at?: string;
}

export interface Announcement {
  id: number;
  class_id: number;
  content: string;
  publish_at?: string | null;
  created_at: string;
}

export interface Submission {
  id: number;
  assignment_id: number;
  student_id: number;
  content: string;
  grade?: string;
  status: 'pending' | 'graded';
  submitted_at: string;
}

export type AttendanceStatus = 'present' | 'late' | 'absent';

export interface AttendanceRecord {
  student_id: number;
  attendance_date: string;
  status: AttendanceStatus;
  checked_at?: string;
}

export interface MonthlyAttendanceSummary {
  student_id: number;
  student_name: string;
  student_code?: string;
  present_count: number;
  late_count: number;
  absent_count: number;
  checked_count: number;
}

export interface LeaderboardEntry {
  user_id: number;
  name: string;
  profile_picture?: string;
  score: number;
  streak: number;
  best_streak: number;
  rank: number;
}

export interface LeaderboardSnapshot {
  classId: number;
  top3: LeaderboardEntry[];
  myRank: LeaderboardEntry | null;
  totalPlayers: number;
}

export interface ClassroomGame {
  id: number;
  class_id: number;
  title: string;
  description?: string;
  total_questions: number;
  time_limit_sec: number;
  is_active: boolean;
  created_at: string;
}

export interface ClassroomGameQuestion {
  id: number;
  class_id: number;
  game_id: number;
  question_text: string;
  choice_a: string;
  choice_b: string;
  choice_c: string;
  choice_d: string;
  display_order: number;
}

export interface ActiveGamePayload {
  game: ClassroomGame | null;
  questions: ClassroomGameQuestion[];
}
