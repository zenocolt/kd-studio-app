import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Plus,
  Users,
  ClipboardList,
  Bell,
  Search,
  LogOut,
  ChevronRight,
  Sparkles,
  Calendar,
  MessageSquare,
  ArrowLeft,
  User as UserIcon,
  GraduationCap,
  CheckCircle2,
  Award,
  Clock,
  AlertCircle,
  Pencil,
  Trash2,
  Save,
  X,
  CircleCheck,
  CircleX,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import * as XLSX from 'xlsx';
import { User, Classroom, Assignment, Announcement, AttendanceRecord, AttendanceStatus, MonthlyAttendanceSummary, LeaderboardSnapshot, ClassroomGame, ClassroomGameQuestion, ActiveGamePayload } from './types';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY ?? '' });

const CLASS_COLOR_THEMES = [
  {
    cardBg: 'bg-[#F8E3E6]',
    border: 'border-[#F8E3E6]',
    hoverBorder: 'group-hover:border-[#EED4DA]',
    iconBg: 'bg-[#F8E3E6]',
    iconText: 'text-[#9678B6]',
    titleHover: 'group-hover:text-[#333]',
    codeBg: 'bg-white/60',
    codeText: 'text-[#888]',
    arrow: 'group-hover:text-[#9678B6]',
    dot: 'bg-[#A6DDB5]'
  },
  {
    cardBg: 'bg-[#D9F1DF]',
    border: 'border-[#D9F1DF]',
    hoverBorder: 'group-hover:border-[#CBE7D3]',
    iconBg: 'bg-[#D9F1DF]',
    iconText: 'text-[#9678B6]',
    titleHover: 'group-hover:text-[#333]',
    codeBg: 'bg-white/60',
    codeText: 'text-[#888]',
    arrow: 'group-hover:text-[#9678B6]',
    dot: 'bg-[#A6DDB5]'
  }
] as const;

const AVATAR_SEEDS = [
  'Panda','Fox','Cat','Dog','Rabbit','Bear',
  'Tiger','Lion','Owl','Penguin','Koala','Dragon',
  'Unicorn','Shark','Whale','Frog','Hamster','Deer',
  'Wolf','Duck','Chick','Bee','Butterfly','Parrot'
];

const AVATAR_OUTFITS = [
  { id: 'fun', label: 'แฟนซี', style: 'fun-emoji' },
  { id: 'school', label: 'นักเรียน', style: 'adventurer' },
  { id: 'hero', label: 'ฮีโร่', style: 'avataaars' }
] as const;

const getAvatarOptionsByOutfit = (outfitStyle: string) =>
  AVATAR_SEEDS.map((seed) => `https://api.dicebear.com/9.x/${outfitStyle}/svg?seed=${seed}`);

const getClassColorTheme = (classroom: Classroom) => {
  const seed = `${classroom.id}-${classroom.code}-${classroom.name}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return CLASS_COLOR_THEMES[hash % CLASS_COLOR_THEMES.length];
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [selectedClass, setSelectedClass] = useState<Classroom | null>(null);
  const [view, setView] = useState<'dashboard' | 'class'>('dashboard');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [selectedAvatarOutfit, setSelectedAvatarOutfit] = useState<(typeof AVATAR_OUTFITS)[number]['id']>('fun');
  const [notifications, setNotifications] = useState<{id: number, title: string, message: string, classId?: number}[]>([]);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [classSearchQuery, setClassSearchQuery] = useState('');
  const [authTab, setAuthTab] = useState<'student' | 'teacher'>('student');
  const [classToDelete, setClassToDelete] = useState<Classroom | null>(null);
  const [isDeletingClass, setIsDeletingClass] = useState(false);
  const [selectedRankClassId, setSelectedRankClassId] = useState<number | null>(null);
  const [leaderboardSnapshot, setLeaderboardSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');

  const normalizedClassSearch = classSearchQuery.trim().toLowerCase();
  const isTeacher = currentUser?.role === 'teacher';
  const classSearchResults = normalizedClassSearch
    ? classes.filter((cls) =>
        cls.name.toLowerCase().includes(normalizedClassSearch) ||
        cls.code.toLowerCase().includes(normalizedClassSearch)
      )
    : [];

  useEffect(() => {
    if (isProfileModalOpen && currentUser) {
      setSelectedAvatar(currentUser.profile_picture || '');

      // If the existing avatar already belongs to a known outfit style, auto-select that outfit.
      const matched = AVATAR_OUTFITS.find((item) => currentUser.profile_picture?.includes(`/${item.style}/svg`));
      setSelectedAvatarOutfit(matched?.id ?? 'fun');
    }
  }, [isProfileModalOpen]);

  useEffect(() => {
    if (!currentUser) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', userId: currentUser.id }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'notification') {
        const newNotif = { id: Date.now(), ...data };
        setNotifications(prev => [newNotif, ...prev]);
        
        // Browser Notification
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(data.title, { body: data.message });
        }
      }
    };

    return () => ws.close();
  }, [currentUser]);

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const loginByIdentifier = async (identifier: string) => {
    const trimmedIdentifier = String(identifier || '').trim();
    if (!trimmedIdentifier) return;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: trimmedIdentifier })
    });
    const user = await res.json();
    if (user.id) {
      setCurrentUser(user);
      fetchClasses(user.id);
      setUsers(prev => {
        if (prev.find(u => u.id === user.id)) return prev;
        return [...prev, user];
      });
    }
  };

  const handleAuthLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const identifier = new FormData(e.currentTarget).get('identifier') as string;
    if (!identifier) return;

    try {
      await loginByIdentifier(identifier);
    } catch (error) {
      console.error("Login Error", error);
    }
  };

  const fetchInitialData = async () => {
    try {
      const resUsers = await fetch('/api/users');
      const dataUsers = await resUsers.json();
      setUsers(dataUsers);
      
      // Removed auto-login for demo
      // if (dataUsers.length > 0) setCurrentUser(dataUsers[0]);
      
      if (currentUser) {
        const resClasses = await fetch(`/api/classes?userId=${currentUser.id}`);
        const dataClasses = await resClasses.json();
        setClasses(dataClasses);
      }
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async (userId: number) => {
    const res = await fetch(`/api/classes?userId=${userId}`);
    const data = await res.json();
    setClasses(data);
  };

  const getTierInfo = (score: number) => {
    if (score >= 151) {
      return { icon: '👑', label: 'God Tier', vibe: 'เทพเจ้าไอที', textClass: 'text-amber-700', bgClass: 'bg-amber-50 border-amber-200' };
    }
    if (score >= 51) {
      return { icon: '🔥', label: 'Pro Player', vibe: 'ตึงจัดในรุ่น', textClass: 'text-orange-700', bgClass: 'bg-orange-50 border-orange-200' };
    }
    return { icon: '🌱', label: 'Rookie', vibe: 'เพิ่งเริ่มคราฟต์', textClass: 'text-emerald-700', bgClass: 'bg-emerald-50 border-emerald-200' };
  };

  const fetchLeaderboard = async (classId: number, userId: number) => {
    setIsLeaderboardLoading(true);
    setLeaderboardError('');
    try {
      const res = await fetch(`/api/classes/${classId}/leaderboard?userId=${userId}`);
      if (!res.ok) {
        let message = 'ไม่สามารถโหลดอันดับคะแนนได้';
        try {
          const data = await res.json();
          if (data?.error && typeof data.error === 'string') {
            message = data.error;
          }
        } catch (error) {
          // Ignore response parsing errors and use fallback message.
        }
        setLeaderboardSnapshot(null);
        setLeaderboardError(message);
        return;
      }

      const data = (await res.json()) as LeaderboardSnapshot;
      setLeaderboardSnapshot(data);
    } catch (error) {
      console.error('Failed to fetch leaderboard', error);
      setLeaderboardSnapshot(null);
      setLeaderboardError('เกิดข้อผิดพลาดระหว่างโหลดอันดับคะแนน');
    } finally {
      setIsLeaderboardLoading(false);
    }
  };

  useEffect(() => {
    if (isTeacher) {
      setSelectedRankClassId(null);
      setLeaderboardSnapshot(null);
      return;
    }

    if (classes.length === 0) {
      setSelectedRankClassId(null);
      setLeaderboardSnapshot(null);
      return;
    }

    setSelectedRankClassId((prev) => {
      if (prev && classes.some((item) => item.id === prev)) return prev;
      return classes[0].id;
    });
  }, [classes, isTeacher]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'student') return;
    if (view !== 'dashboard') return;
    if (!selectedRankClassId) return;

    fetchLeaderboard(selectedRankClassId, currentUser.id);
  }, [selectedRankClassId, currentUser?.id, currentUser?.role, view]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'student') return;
    if (view !== 'dashboard') return;
    if (!selectedRankClassId) return;

    const intervalId = setInterval(() => {
      fetchLeaderboard(selectedRankClassId, currentUser.id);
    }, 5000);

    return () => clearInterval(intervalId);
  }, [selectedRankClassId, currentUser?.id, currentUser?.role, view]);

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const profile_picture = currentUser.role === 'student'
      ? selectedAvatar
      : formData.get('profile_picture') as string;
    const contact_info = formData.get('contact_info') as string;
    const bio = formData.get('bio') as string;
    const student_id = formData.get('student_id') as string;
    const email = formData.get('email') as string;

    const res = await fetch(`/api/users/${currentUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, profile_picture, contact_info, bio, student_id, email })
    });

    if (res.ok) {
      const updatedUser = await res.json();
      setCurrentUser(updatedUser);
      setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
      setIsProfileModalOpen(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    if (!currentUser) return;

    const res = await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, teacherId: currentUser.id })
    });

    if (res.ok) {
      setIsCreateModalOpen(false);
      fetchClasses(currentUser.id);
    }
  };

  const handleJoinClass = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const code = formData.get('code') as string;

    if (!currentUser) return;

    const res = await fetch('/api/classes/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, userId: currentUser.id })
    });

    if (res.ok) {
      setIsJoinModalOpen(false);
      fetchClasses(currentUser.id);
    } else {
      alert("Invalid code or already joined");
    }
  };

  const handleDeleteClass = async (classroom: Classroom) => {
    if (!currentUser || currentUser.role !== 'teacher') return;
    setClassToDelete(classroom);
  };

  const confirmDeleteClass = async () => {
    if (!currentUser || currentUser.role !== 'teacher' || !classToDelete) return;
    setIsDeletingClass(true);

    try {
      const res = await fetch(`/api/classes/${classToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: currentUser.id })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData?.error || 'ไม่สามารถลบวิชาได้');
        setIsDeletingClass(false);
        return;
      }

      if (selectedClass?.id === classToDelete.id) {
        setSelectedClass(null);
        setView('dashboard');
      }

      setClassToDelete(null);
      fetchClasses(currentUser.id);
    } catch (error) {
      alert('เกิดข้อผิดพลาดระหว่างลบวิชา');
    } finally {
      setIsDeletingClass(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <BookOpen className="w-12 h-12 text-pink-500 mb-4" />
          <p className="text-slate-500 font-medium tracking-wide">กำลังโหลด KD.Classroom...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F1E9F6] p-6">
        <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(30deg,rgba(202,181,221,0.18)_12%,transparent_12.5%,transparent_87%,rgba(202,181,221,0.18)_87.5%,rgba(202,181,221,0.18)),linear-gradient(150deg,rgba(202,181,221,0.18)_12%,transparent_12.5%,transparent_87%,rgba(202,181,221,0.18)_87.5%,rgba(202,181,221,0.18)),linear-gradient(90deg,rgba(202,181,221,0.12)_2%,transparent_2.5%,transparent_97%,rgba(202,181,221,0.12)_97.5%,rgba(202,181,221,0.12))] [background-size:64px_112px] [background-position:0_0,0_0,0_0]" />

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative w-full max-w-[400px]"
        >
          <div className="rounded-[30px] bg-white p-10 shadow-[0_4px_10px_rgba(0,0,0,0.02)]">
            <div className="mb-8 flex items-center justify-center gap-2">
              <GraduationCap className="h-7 w-7 text-[#CAB5DD]" />
              <p className="text-[24px] font-bold tracking-tight text-[#CAB5DD]">KD.CLASSROOM</p>
            </div>

            <div className="mb-7 text-center">
              <h1 className="text-[32px] font-bold leading-tight text-[#444]">YO, KRU DAI! LET'S GET IT! 🔥</h1>
              <p className="mt-2 text-[16px] font-normal text-[#888]">READY TO POP INTO CLASS?</p>
            </div>

            <div className="mb-6 flex rounded-[15px] bg-[#F3F3F3] p-[5px]">
              <button
                type="button"
                onClick={() => setAuthTab('student')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-semibold transition-all ${
                  authTab === 'student'
                    ? 'border border-[#F8E3E6] bg-white text-[#EC2D8B]'
                    : 'text-[#888]'
                }`}
              >
                <Users className="h-4 w-4" />
                Student
              </button>
              <button
                type="button"
                onClick={() => setAuthTab('teacher')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-semibold transition-all ${
                  authTab === 'teacher'
                    ? 'border border-[#F8E3E6] bg-white text-[#EC2D8B]'
                    : 'text-[#888]'
                }`}
              >
                <ClipboardList className="h-4 w-4" />
                Teacher
              </button>
            </div>

            <form onSubmit={handleAuthLogin} className="space-y-5">
              <input
                name="identifier"
                required
                className="h-12 w-full rounded-[20px] border-2 border-[#CAB5DD] bg-white px-[15px] text-[14px] text-[#444] outline-none placeholder:text-[#888]"
                placeholder={authTab === 'student' ? 'STUDENT ID (รหัสประจำตัว)' : 'EMAIL / PHONE NUMBER'}
              />
              <button
                type="submit"
                className="h-[50px] w-full rounded-[24px] border-[1.5px] border-[#CAB5DD] bg-[#F8E3E6] text-[20px] font-extrabold text-[#444] shadow-[0_0_16px_rgba(202,181,221,0.26)] transition-all hover:brightness-95"
              >
                LET'S GO! 🚀
              </button>
            </form>
          </div>
        </motion.div>

        <div className="fixed bottom-6 right-6 rounded-2xl border-[1.5px] border-[#CAB5DD] bg-[#F1E9F6] px-4 py-3 text-[#7A6491] shadow-[0_4px_10px_rgba(0,0,0,0.02)]">
          <p className="text-[11px] font-bold tracking-[0.12em]">VIBE CHECK</p>
          <p className="text-xs font-semibold">Pastel mode is on ✨</p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen text-[#333] font-sans">
      <nav className="sticky top-0 z-50 px-6 pt-6 md:px-10">
        <div className="header-container mx-auto grid w-full grid-cols-3 items-center rounded-2xl border-2 border-[#CAB5DD] bg-[#FEFCFB] px-4 py-3 shadow-[0_12px_26px_rgba(75,46,114,0.18)] md:px-8">
          <div className="flex justify-start">
            <button
              type="button"
              className="flex items-center gap-2.5 transition-transform hover:scale-105"
              onClick={() => {
                setView('dashboard');
                setSelectedClass(null);
              }}
            >
              <GraduationCap className="h-6 w-6 text-[#9678B6]" />
              <h1 className="text-[24px] font-bold tracking-tight text-[#CAB5DD]">KD.CLASSROOM</h1>
            </button>
          </div>

          <div className="flex justify-center">
            <div className="relative w-full max-w-[300px]">
              <div className="flex h-[36px] items-center gap-2 rounded-full bg-[#FDFCE4] py-2 pl-3 pr-4">
                <Search className="h-4 w-4 text-[#9678B6] opacity-60" />
                <input
                  type="text"
                  value={classSearchQuery}
                  onChange={(e) => setClassSearchQuery(e.target.value)}
                  placeholder="Search vibes..."
                  className="w-full border-none bg-transparent text-sm text-[#333] placeholder:text-[#777] outline-none"
                />
              </div>

              {normalizedClassSearch && (
                <div className="absolute top-full z-[120] mt-2 w-full overflow-hidden rounded-2xl border border-[#E7DEEE] bg-white/95 shadow-xl">
                  {classSearchResults.length > 0 ? (
                    classSearchResults.slice(0, 6).map((cls) => {
                      const theme = getClassColorTheme(cls);
                      return (
                        <button
                          key={cls.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedClass(cls);
                            setView('class');
                            setClassSearchQuery('');
                          }}
                          className="w-full border-b border-[#F3EEF7] px-4 py-3 text-left transition-colors hover:bg-[#FAF7FD] last:border-b-0"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`h-2.5 w-2.5 rounded-full ${theme.dot}`} />
                            <span className="truncate text-sm font-semibold text-[#333]">{cls.name}</span>
                            <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-bold ${theme.codeBg} ${theme.codeText}`}>
                              {cls.code}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-4 py-3 text-sm text-[#777]">ไม่พบชั้นเรียนที่ค้นหา</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <div className={`hidden md:flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${isTeacher ? 'border-[#CAB5DD]/30 text-[#9678B6]' : 'border-sky-300 text-sky-700'} bg-white/70`}>
              {currentUser?.profile_picture ? (
                <img src={currentUser.profile_picture} alt="" className="h-5 w-5 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className={`h-4 w-4 ${isTeacher ? 'text-[#9678B6]' : 'text-sky-500'}`} />
              )}
              <span>{currentUser?.name}</span>
            </div>

            <div className="relative">
              <div className="flex gap-1.5 rounded-full bg-[#F1E9F6] p-1.5">
                <button
                  onClick={() => setIsProfileModalOpen(true)}
                  className="rounded-full p-1.5 text-[#9678B6] transition-colors hover:bg-white"
                  title="โปรไฟล์"
                >
                  <UserIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                  className="relative rounded-full p-1.5 text-[#9678B6] transition-colors hover:bg-white"
                  title="การแจ้งเตือน"
                >
                  <Bell className="h-4 w-4" />
                  {notifications.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#A6DDB5]" />}
                </button>
                <button
                  onClick={() => setCurrentUser(null)}
                  className="rounded-full p-1.5 text-[#9678B6] transition-colors hover:bg-white"
                  title="ออกจากระบบ"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>

              <AnimatePresence>
                {isNotificationOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 z-[100] mt-2 w-80 overflow-hidden rounded-2xl border border-[#E7DEEE] bg-white shadow-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-[#F3EEF7] bg-[#FEFCFB] p-4">
                      <h3 className="font-bold text-[#333]">การแจ้งเตือน</h3>
                      <button
                        onClick={() => setNotifications([])}
                        className="text-xs font-bold text-[#CAB5DD] transition-colors hover:text-[#B29ACD]"
                      >
                        ล้างทั้งหมด
                      </button>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-[#777]">
                          <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
                          <p className="text-sm">ไม่มีการแจ้งเตือนใหม่</p>
                        </div>
                      ) : (
                        notifications.map(notif => (
                          <div key={notif.id} className="cursor-pointer border-b border-[#F7F3FA] p-4 transition-colors hover:bg-[#FAF7FD]">
                            <p className="text-sm font-bold text-[#333]">{notif.title}</p>
                            <p className="mt-1 text-xs text-[#777]">{notif.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </nav>

      <main className="px-6 pb-16 pt-8 md:px-10">
        <div className="mx-auto max-w-6xl">
          <AnimatePresence mode="wait">
            {view === 'dashboard' ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="mb-10 flex flex-col items-center text-center">
                  <h2 className="welcome-title text-[36px] font-bold text-[#333]">
                    {isTeacher ? "YO, KRU DAI! LET'S GET IT! 🔥" : "HEY, CLASS STAR! LET'S LEARN! ✨"}
                  </h2>
                  <p className="mt-1 text-[16px] font-bold text-[#555]">
                    {isTeacher
                      ? `YOU HAVE ${classes.length} CLASSES READY TO POP`
                      : `YOU HAVE ${classes.length} CLASSES READY TO JOIN`}
                  </p>

                  <div className="mt-6 flex gap-3">
                    {currentUser?.role === 'teacher' ? (
                      <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="flex items-center gap-2 rounded-[20px] border-[1.5px] border-[#9678B6] bg-[#EC2D8B] px-[30px] py-[10px] font-semibold text-white shadow-[0_8px_18px_rgba(236,45,139,0.35)] transition-all hover:brightness-95"
                      >
                        <Plus className="h-5 w-5" />
                        + Create Class
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsJoinModalOpen(true)}
                        className="flex items-center gap-2 rounded-[20px] border-[1.5px] border-[#9678B6] bg-[#EC2D8B] px-[30px] py-[10px] font-semibold text-white shadow-[0_8px_18px_rgba(236,45,139,0.35)] transition-all hover:brightness-95"
                      >
                        <Plus className="h-5 w-5" />
                        Join Class
                      </button>
                    )}
                  </div>
                </div>

                <div className={`grid grid-cols-1 gap-6 ${!isTeacher ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
                  <div className="grid grid-cols-1 gap-[30px] md:grid-cols-2">
                    {classes.map((cls) => (
                      <ClassCard
                        key={cls.id}
                        classroom={cls}
                        canDelete={currentUser?.role === 'teacher'}
                        onDelete={() => handleDeleteClass(cls)}
                        onClick={() => {
                          setSelectedClass(cls);
                          setView('class');
                        }}
                      />
                    ))}
                    {classes.length === 0 && (
                      <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#9678B6] bg-[#FEFCFB] py-20 shadow-[0_14px_30px_rgba(75,46,114,0.18)]">
                        <BookOpen className="mb-4 h-12 w-12 text-[#9678B6]" />
                        <p className="font-medium text-[#333]">ไม่พบชั้นเรียน เริ่มจากสร้างหรือเข้าร่วมชั้นเรียนได้เลย</p>
                      </div>
                    )}
                  </div>

                  {!isTeacher && (
                    <aside className="h-fit rounded-3xl border-2 border-[#CAB5DD] bg-[#F1E9F6] p-5 shadow-[0_12px_26px_rgba(75,46,114,0.18)]">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-extrabold tracking-[0.1em] text-[#7A6491]">🔥 HALL OF FAME</p>
                          <p className="text-sm font-semibold text-[#5B466F]">VIBE RANKING</p>
                        </div>
                        <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-[#9678B6]">REALTIME READY</span>
                      </div>

                      <div className="mb-4">
                        <label className="mb-1 block text-xs font-semibold text-[#7A6491]">เลือกวิชา</label>
                        <select
                          value={selectedRankClassId ?? ''}
                          onChange={(e) => setSelectedRankClassId(Number(e.target.value))}
                          className="w-full rounded-xl border border-[#D9CCE7] bg-white px-3 py-2 text-sm text-[#4E3E62] outline-none focus:ring-2 focus:ring-[#CAB5DD]"
                          disabled={classes.length === 0}
                        >
                          {classes.map((cls) => (
                            <option key={cls.id} value={cls.id}>{cls.name}</option>
                          ))}
                        </select>
                      </div>

                      {isLeaderboardLoading ? (
                        <div className="rounded-2xl bg-white/75 px-4 py-6 text-center text-sm font-semibold text-[#7A6491]">กำลังโหลดอันดับ...</div>
                      ) : leaderboardError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{leaderboardError}</div>
                      ) : !leaderboardSnapshot || leaderboardSnapshot.totalPlayers === 0 ? (
                        <div className="rounded-2xl bg-white/75 px-4 py-6 text-center text-sm font-semibold text-[#7A6491]">ยังไม่มีคะแนนในวิชานี้</div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {leaderboardSnapshot.top3.map((entry) => {
                              const tier = getTierInfo(entry.score);
                              return (
                                <div key={entry.user_id} className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/85 px-3 py-2.5">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F8E3E6] text-sm font-extrabold text-[#EC2D8B]">#{entry.rank}</div>
                                  <div className="h-9 w-9 overflow-hidden rounded-full bg-slate-100">
                                    {entry.profile_picture ? (
                                      <img src={entry.profile_picture} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-sm">👾</div>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-[#4E3E62]">{entry.name}</p>
                                    <p className="text-[11px] font-semibold text-[#8A76A0]">{entry.score} pts • streak {entry.streak}</p>
                                  </div>
                                  <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${tier.bgClass} ${tier.textClass}`}>{tier.icon} {tier.label}</span>
                                </div>
                              );
                            })}
                          </div>

                          {leaderboardSnapshot.myRank && (() => {
                            const meTier = getTierInfo(leaderboardSnapshot.myRank.score);
                            return (
                              <div className="mt-4 rounded-2xl border border-[#D9CCE7] bg-white px-4 py-3">
                                <p className="text-xs font-bold tracking-[0.08em] text-[#8A76A0]">อันดับของคุณ</p>
                                <div className="mt-1 flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-lg font-extrabold text-[#4E3E62]">#{leaderboardSnapshot.myRank.rank}</p>
                                    <p className="text-sm font-semibold text-[#6B567F]">{leaderboardSnapshot.myRank.score} คะแนน</p>
                                  </div>
                                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${meTier.bgClass} ${meTier.textClass}`}>{meTier.icon} {meTier.label}</span>
                                </div>
                                <p className="mt-1 text-[11px] font-medium text-[#8A76A0]">{meTier.vibe} • best streak {leaderboardSnapshot.myRank.best_streak}</p>
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </aside>
                  )}
                </div>
              </motion.div>
            ) : (
              <ClassView
                key={selectedClass?.id || 'class-view'}
                classroom={selectedClass!}
                currentUser={currentUser!}
                users={users}
                onBack={() => {
                  setView('dashboard');
                  setSelectedClass(null);
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      {view === 'dashboard' && (
        <div className="fixed bottom-32 right-6 z-[160] hidden rounded-2xl border-2 border-[#9678B6] bg-[#E4D7EE] px-4 py-3 text-[#4E3E62] shadow-[0_12px_26px_rgba(75,46,114,0.18)] md:block">
          <p className="text-[11px] font-bold tracking-[0.12em]">VIBE CHECK</p>
          <p className="text-xs font-semibold">Pastel mode is on ✨</p>
        </div>
      )}

      {/* Notification Toasts */}
      <div className="fixed bottom-6 right-6 z-[200] space-y-3">
        <AnimatePresence>
          {notifications.slice(0, 3).map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className="bg-white/90 backdrop-blur-xl border border-pink-200 p-4 rounded-2xl shadow-2xl shadow-pink-100/50 flex gap-4 w-80"
            >
              <div className="bg-pink-500 p-2 rounded-xl h-fit">
                <Bell className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-sm">{notif.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{notif.message}</p>
              </div>
              <button 
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                className="ml-auto text-slate-400 hover:text-slate-600"
              >
                <Plus className="w-4 h-4 rotate-45" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Modals */}
      {isCreateModalOpen && (
        <Modal title="สร้างชั้นเรียนใหม่" onClose={() => setIsCreateModalOpen(false)}>
          <form onSubmit={handleCreateClass} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">ชื่อชั้นเรียน</label>
              <input name="name" required className="w-full px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-pink-500 outline-none" placeholder="เช่น ฟิสิกส์ขั้นสูง" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">คำอธิบาย</label>
              <textarea name="description" className="w-full px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-pink-500 outline-none h-24" placeholder="ชั้นเรียนนี้เกี่ยวกับอะไร?" />
            </div>
            <button type="submit" className="w-full bg-pink-600 text-white py-2.5 rounded-xl font-semibold hover:bg-pink-500 transition-all shadow-lg shadow-pink-100">สร้างชั้นเรียน</button>
          </form>
        </Modal>
      )}

      {isJoinModalOpen && (
        <Modal title="เข้าร่วมชั้นเรียน" onClose={() => setIsJoinModalOpen(false)}>
          <form onSubmit={handleJoinClass} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">รหัสชั้นเรียน</label>
              <input name="code" required className="w-full px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-pink-500 outline-none text-center text-xl font-bold tracking-widest uppercase" placeholder="ABCDEF" maxLength={6} />
              <p className="text-xs text-slate-400 mt-2 text-center">ขอรหัสชั้นเรียน 6 หลักจากครูของคุณ</p>
            </div>
            <button type="submit" className="w-full bg-pink-600 text-white py-2.5 rounded-xl font-semibold hover:bg-pink-500 transition-all shadow-lg shadow-pink-100">เข้าร่วมชั้นเรียน</button>
          </form>
        </Modal>
      )}

      {isProfileModalOpen && currentUser && (
        <Modal title="โปรไฟล์ของฉัน" onClose={() => setIsProfileModalOpen(false)}>
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <img 
                  src={selectedAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=random`} 
                  alt={currentUser.name} 
                  className="w-24 h-24 rounded-full object-cover border-4 border-pink-100 shadow-lg"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">ชื่อ</label>
              <input 
                name="name" 
                defaultValue={currentUser.name} 
                required 
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none bg-slate-50 text-slate-900 focus:ring-2 focus:ring-pink-500" 
                placeholder="ชื่อของคุณ" 
              />
            </div>
            {currentUser.role === 'student' && (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">รหัสนักศึกษา</label>
                <input 
                  name="student_id" 
                  defaultValue={currentUser.student_id || ''} 
                  readOnly
                  className="w-full px-4 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 outline-none cursor-not-allowed" 
                  placeholder="รหัสนักศึกษา"
                />
                <p className="text-[10px] text-slate-400 mt-1">รหัสนักศึกษาต้องให้ครูเป็นผู้กำหนด</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">อีเมล</label>
              <input 
                name="email" 
                defaultValue={currentUser.email || ''} 
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none bg-slate-50 text-slate-900 focus:ring-2 focus:ring-pink-500" 
                placeholder="example@email.com"
              />
            </div>
            {currentUser.role === 'student' ? (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-2">เลือกอวาตาร์ของคุณ ✨</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {AVATAR_OUTFITS.map((outfit) => (
                    <button
                      key={outfit.id}
                      type="button"
                      onClick={() => setSelectedAvatarOutfit(outfit.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                        selectedAvatarOutfit === outfit.id
                          ? 'bg-pink-600 text-white shadow'
                          : 'bg-white text-slate-600 border border-slate-200 hover:border-pink-300'
                      }`}
                    >
                      ชุด{outfit.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-6 gap-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {getAvatarOptionsByOutfit(AVATAR_OUTFITS.find((o) => o.id === selectedAvatarOutfit)?.style || 'fun-emoji').map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setSelectedAvatar(url)}
                      className={`w-full aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                        selectedAvatar === url
                          ? 'border-pink-500 ring-2 ring-pink-300 scale-105 shadow-lg'
                          : 'border-transparent hover:border-pink-300'
                      }`}
                    >
                      <img src={url} alt="avatar" className="w-full h-full" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">รูปโปรไฟล์ (URL)</label>
                <input 
                  name="profile_picture" 
                  defaultValue={currentUser.profile_picture} 
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none bg-slate-50 text-slate-900 focus:ring-2 focus:ring-pink-500" 
                  placeholder="https://example.com/image.jpg" 
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">ข้อมูลติดต่อ</label>
              <input 
                name="contact_info" 
                defaultValue={currentUser.contact_info} 
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none bg-slate-50 text-slate-900 focus:ring-2 focus:ring-pink-500" 
                placeholder="โทรศัพท์ หรือ โซเชียลมีเดีย" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">ประวัติย่อ (Bio)</label>
              <textarea 
                name="bio" 
                defaultValue={currentUser.bio} 
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none h-24 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-pink-500" 
                placeholder="บอกเล่าเรื่องราวของคุณ..." 
              />
            </div>
            <button type="submit" className="w-full bg-pink-600 text-white py-2.5 rounded-xl font-semibold hover:bg-pink-500 transition-all shadow-lg shadow-pink-100">บันทึกโปรไฟล์</button>
          </form>
        </Modal>
      )}

      <AnimatePresence>
        {classToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[260] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-[#b79ab6]/40 backdrop-blur-sm" onClick={() => !isDeletingClass && setClassToDelete(null)} />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              className="relative w-full max-w-md rounded-[30px] bg-white px-8 py-9 shadow-[0_20px_45px_rgba(0,0,0,0.14)]"
            >
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-rose-100 bg-rose-50">
                <AlertCircle className="h-10 w-10 text-rose-400" />
              </div>

              <h3 className="text-center text-[38px] font-extrabold text-slate-800">ยืนยันการลบข้อมูล?</h3>
              <p className="mt-4 text-center text-sm leading-relaxed text-slate-500">
                คุณกำลังลบข้อมูลของ <span className="font-bold text-rose-500">"{classToDelete.name}"</span>
                <br />ข้อมูลทั้งหมดจะถูกลบถาวรและไม่สามารถกู้คืนได้
              </p>

              <div className="mt-8 space-y-3">
                <button
                  onClick={confirmDeleteClass}
                  disabled={isDeletingClass}
                  className="w-full rounded-2xl bg-[#EC2D8B] py-3 text-lg font-extrabold text-white shadow-[0_10px_22px_rgba(236,45,139,0.35)] transition-all hover:brightness-95 disabled:opacity-70"
                >
                  {isDeletingClass ? 'กำลังลบข้อมูล...' : 'ยืนยันลบข้อมูล'}
                </button>
                <button
                  onClick={() => setClassToDelete(null)}
                  disabled={isDeletingClass}
                  className="w-full rounded-2xl bg-slate-100 py-3 text-lg font-bold text-slate-500 transition-all hover:bg-slate-200 disabled:opacity-70"
                >
                  ยกเลิก
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ClassCard: React.FC<{ classroom: Classroom, onClick: () => void, onDelete?: () => void, canDelete?: boolean }> = ({ classroom, onClick, onDelete, canDelete }) => {
  const theme = getClassColorTheme(classroom);

  return (
    <motion.div
      whileHover={{ y: -3 }}
      onClick={onClick}
      transition={{ duration: 0.2 }}
      className={`card ${theme.cardBg} ${theme.border} ${theme.hoverBorder} group cursor-pointer rounded-2xl border-2 border-[#CAB5DD] p-6 text-left shadow-[0_14px_30px_rgba(75,46,114,0.18)] transition-all`}
    >
      <div className="mb-5 overflow-hidden rounded-xl border border-white/60 bg-white/35 p-3">
        <div className="relative h-24 rounded-lg bg-gradient-to-br from-white/70 via-[#EBDFF4]/70 to-[#D8EFE0]/80">
          <div className="absolute -left-6 -top-6 h-16 w-16 rounded-full bg-white/70 blur-xl" />
          <div className="absolute right-3 top-3 h-14 w-14 rounded-full bg-[#E9D9F3]/70 blur-lg" />
          <div className="absolute bottom-2 left-1/3 h-12 w-12 rounded-full bg-[#CDEBD7]/75 blur-lg" />
        </div>
      </div>

      <h3 className={`mb-3 text-[20px] font-bold leading-snug text-[#333] ${theme.titleHover}`}>
        {classroom.name}
      </h3>

      <div className="space-y-1.5 text-[12px] text-[#666]">
        <p>รหัสวิชา: <span className={`font-semibold ${theme.codeText}`}>{classroom.code}</span></p>
        <p className="line-clamp-1">ระดับชั้น: {classroom.description || 'General Classroom'}</p>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-black/5 pt-4">
        <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/45 px-3 py-1.5">
          <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
          <span className="text-xs font-bold text-[#CAB5DD]">ACTIVE</span>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded-full border border-rose-200 bg-white/80 px-3 py-1 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50"
            >
              ลบวิชา
            </button>
          )}
          <ChevronRight className={`h-4 w-4 text-[#9678B6] ${theme.arrow} transition-all group-hover:translate-x-1`} />
        </div>
      </div>
    </motion.div>
  );
};

const ClassView: React.FC<{ classroom: Classroom, currentUser: User, users: User[], onBack: () => void }> = ({ classroom, currentUser, users, onBack }) => {
  const classTheme = getClassColorTheme(classroom);
  const [tab, setTab] = useState<'stream' | 'classwork' | 'people' | 'attendance'>('stream');
  const [classworkMenu, setClassworkMenu] = useState<'assignments' | 'game'>('assignments');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [games, setGames] = useState<ClassroomGame[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isCreateGameOpen, setIsCreateGameOpen] = useState(false);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [gameForm, setGameForm] = useState({ title: '', description: '', total_questions: '10', time_limit_sec: '20' });
  const [gameQuestionsDraft, setGameQuestionsDraft] = useState<Array<{
    questionText: string;
    choiceA: string;
    choiceB: string;
    choiceC: string;
    choiceD: string;
    correctChoice: 'A' | 'B' | 'C' | 'D';
  }>>([]);
  const [questionDraft, setQuestionDraft] = useState({
    questionText: '',
    choiceA: '',
    choiceB: '',
    choiceC: '',
    choiceD: '',
    correctChoice: 'A' as 'A' | 'B' | 'C' | 'D'
  });
  const [activeGamePayload, setActiveGamePayload] = useState<ActiveGamePayload>({ game: null, questions: [] });
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<'A' | 'B' | 'C' | 'D' | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [classTeacher, setClassTeacher] = useState<User | null>(null);
  const [classStudents, setClassStudents] = useState<User[]>([]);
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const [studentForm, setStudentForm] = useState({ name: '', student_id: '', bio: '' });
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [isImportingStudents, setIsImportingStudents] = useState(false);
  const [addStudentForm, setAddStudentForm] = useState({ student_id: '', full_name: '' });
  const [toasts, setToasts] = useState<{ id: number; type: 'success' | 'error'; message: string }[]>([]);
  const [studentSearchInput, setStudentSearchInput] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [attendanceDate, setAttendanceDate] = useState(() => {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    return today.toISOString().split('T')[0];
  });
  const [attendanceByStudent, setAttendanceByStudent] = useState<Record<number, AttendanceStatus | undefined>>({});
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const [reportMonth, setReportMonth] = useState(() => {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    return today.toISOString().slice(0, 7);
  });
  const [monthlyReportSearch, setMonthlyReportSearch] = useState('');
  const [monthlyRateSort, setMonthlyRateSort] = useState<'desc' | 'asc'>('desc');
  const [attendanceWarningThreshold, setAttendanceWarningThreshold] = useState(80);
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);
  const [monthlyReportRows, setMonthlyReportRows] = useState<MonthlyAttendanceSummary[]>([]);
  const [isMonthlyReportLoading, setIsMonthlyReportLoading] = useState(false);
  const [myQuestScore, setMyQuestScore] = useState(0);
  const [myQuestStreak, setMyQuestStreak] = useState(0);
  const [myQuestBestStreak, setMyQuestBestStreak] = useState(0);
  const [undoStudent, setUndoStudent] = useState<User | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const UNDO_SECONDS = 5;
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstFilteredStudentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchClassData();
  }, [classroom.id]);

  useEffect(() => {
    if (classStudents.length === 0) {
      setAttendanceByStudent({});
      return;
    }

    fetchAttendanceForDate(attendanceDate, classStudents);
  }, [attendanceDate]);

  useEffect(() => {
    if (tab !== 'attendance') return;
    fetchMonthlyAttendanceReport(reportMonth);
  }, [reportMonth, tab]);

  const fetchAttendanceForDate = async (date: string, students: User[]) => {
    if (students.length === 0) {
      setAttendanceByStudent({});
      return;
    }

    setIsAttendanceLoading(true);
    try {
      const res = await fetch(`/api/classes/${classroom.id}/attendance?date=${encodeURIComponent(date)}`);

      const nextState: Record<number, AttendanceStatus | undefined> = {};
      students.forEach((student) => {
        nextState[student.id] = undefined;
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถดึงข้อมูลการเช็คชื่อได้');
        showToast('error', errorMessage);
        setAttendanceByStudent(nextState);
        return;
      }

      const data = await res.json();
      const records = (data.records || []) as AttendanceRecord[];
      records.forEach((record) => {
        if (record.status) {
          nextState[record.student_id] = record.status;
        }
      });

      setAttendanceByStudent(nextState);
    } catch (error) {
      console.error('Failed to fetch attendance', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างโหลดข้อมูลการเช็คชื่อ');
    } finally {
      setIsAttendanceLoading(false);
    }
  };

  const fetchMonthlyAttendanceReport = async (month: string) => {
    if (currentUser.role !== 'teacher') {
      setMonthlyReportRows([]);
      return;
    }

    setIsMonthlyReportLoading(true);
    try {
      const res = await fetch(
        `/api/classes/${classroom.id}/attendance/monthly?month=${encodeURIComponent(month)}&actorId=${currentUser.id}`
      );

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถดึงรายงานเช็คชื่อรายเดือนได้');
        showToast('error', errorMessage);
        setMonthlyReportRows([]);
        return;
      }

      const data = await res.json();
      setMonthlyReportRows((data.rows || []) as MonthlyAttendanceSummary[]);
    } catch (error) {
      console.error('Failed to fetch monthly attendance report', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างโหลดรายงานเช็คชื่อรายเดือน');
      setMonthlyReportRows([]);
    } finally {
      setIsMonthlyReportLoading(false);
    }
  };

  const fetchClassData = async () => {
    const readJsonSafely = async <T,>(res: Response, fallback: T): Promise<T> => {
      try {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return fallback;
        }
        return (await res.json()) as T;
      } catch {
        return fallback;
      }
    };

    try {
      const [assResult, gamesResult, annResult, peopleResult] = await Promise.allSettled([
        fetch(`/api/classes/${classroom.id}/assignments?userId=${currentUser.id}`),
        fetch(`/api/classes/${classroom.id}/games?userId=${currentUser.id}`),
        fetch(`/api/classes/${classroom.id}/announcements`),
        fetch(`/api/classes/${classroom.id}/people`)
      ]);

      if (assResult.status === 'fulfilled' && assResult.value.ok) {
        setAssignments(await readJsonSafely<Assignment[]>(assResult.value, []));
      } else {
        setAssignments([]);
      }

      if (gamesResult.status === 'fulfilled' && gamesResult.value.ok) {
        setGames(await readJsonSafely<ClassroomGame[]>(gamesResult.value, []));
      } else {
        setGames([]);
      }

      if (annResult.status === 'fulfilled' && annResult.value.ok) {
        setAnnouncements(await readJsonSafely<Announcement[]>(annResult.value, []));
      } else {
        setAnnouncements([]);
      }

      if (peopleResult.status === 'fulfilled' && peopleResult.value.ok) {
        const people = await readJsonSafely<{ teacher?: User | null; students?: User[] }>(peopleResult.value, { teacher: null, students: [] });
        const students = people.students ?? [];
        setClassTeacher(people.teacher ?? null);
        setClassStudents(students);
        fetchAttendanceForDate(attendanceDate, students);
        return;
      }

      const fallbackStudents: User[] = [];
      setClassTeacher(users.find(u => u.id === classroom.teacher_id) ?? null);
      setClassStudents(fallbackStudents);
      fetchAttendanceForDate(attendanceDate, fallbackStudents);
      showToast('error', 'โหลดรายชื่อนักเรียนจากห้องเรียนไม่สำเร็จ ใช้ข้อมูลสำรองแทน');
    } catch (error) {
      const fallbackStudents: User[] = [];
      setAssignments([]);
      setGames([]);
      setAnnouncements([]);
      setClassTeacher(users.find(u => u.id === classroom.teacher_id) ?? null);
      setClassStudents(fallbackStudents);
      fetchAttendanceForDate(attendanceDate, fallbackStudents);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างโหลดข้อมูลชั้นเรียน');
      console.error('Failed to fetch class data', error);
    }
  };

  const createGame = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (currentUser.role !== 'teacher') {
      showToast('error', 'เฉพาะครูเท่านั้นที่สร้างเกมได้');
      return;
    }

    const title = gameForm.title.trim();
    const description = gameForm.description.trim();
    const totalQuestions = Number(gameForm.total_questions || 10);
    const timeLimitSec = Number(gameForm.time_limit_sec || 20);

    if (!title) {
      showToast('error', 'กรุณาระบุชื่อเกม');
      return;
    }

    if (gameQuestionsDraft.length === 0) {
      showToast('error', 'กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ');
      return;
    }

    setIsCreatingGame(true);
    try {
      const res = await fetch(`/api/classes/${classroom.id}/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: currentUser.id,
          title,
          description,
          totalQuestions,
          timeLimitSec,
          questions: gameQuestionsDraft
        })
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถสร้างเกมได้');
        showToast('error', errorMessage);
        return;
      }

      const game = (await res.json()) as ClassroomGame;
      setGames((prev) => [game, ...prev]);
      setGameForm({ title: '', description: '', total_questions: '10', time_limit_sec: '20' });
      setGameQuestionsDraft([]);
      setQuestionDraft({ questionText: '', choiceA: '', choiceB: '', choiceC: '', choiceD: '', correctChoice: 'A' });
      setIsCreateGameOpen(false);
      showToast('success', 'สร้างเกมสำเร็จแล้ว');
    } catch (error) {
      console.error('Failed to create game', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างสร้างเกม');
    } finally {
      setIsCreatingGame(false);
    }
  };

  const getQuestTier = (score: number) => {
    if (score >= 151) {
      return { icon: '👑', label: 'God Tier', vibe: 'เทพเจ้าไอที' };
    }
    if (score >= 51) {
      return { icon: '🔥', label: 'Pro Player', vibe: 'ตึงจัดในรุ่น' };
    }
    return { icon: '🌱', label: 'Rookie', vibe: 'เพิ่งเริ่มคราฟต์' };
  };

  const fetchMyQuestScore = async () => {
    if (currentUser.role !== 'student') return;

    try {
      const res = await fetch(`/api/classes/${classroom.id}/leaderboard?userId=${currentUser.id}`);
      if (!res.ok) {
        setMyQuestScore(0);
        setMyQuestStreak(0);
        setMyQuestBestStreak(0);
        return;
      }

      const data = await res.json();
      const me = data?.myRank;
      setMyQuestScore(Number(me?.score || 0));
      setMyQuestStreak(Number(me?.streak || 0));
      setMyQuestBestStreak(Number(me?.best_streak || 0));
    } catch (error) {
      console.error('Failed to fetch my quest score', error);
      setMyQuestScore(0);
      setMyQuestStreak(0);
      setMyQuestBestStreak(0);
    }
  };

  const fetchActiveGame = async () => {
    if (currentUser.role !== 'student') return;
    try {
      const res = await fetch(`/api/classes/${classroom.id}/games/active?userId=${currentUser.id}`);
      if (!res.ok) {
        setActiveGamePayload({ game: null, questions: [] });
        return;
      }
      const data = (await res.json()) as ActiveGamePayload;
      setActiveGamePayload(data);
      setActiveQuestionIndex(0);
      setSelectedChoice(null);
      setTimeLeft(Number(data.game?.time_limit_sec || 0));
    } catch (error) {
      console.error('Failed to fetch active game', error);
      setActiveGamePayload({ game: null, questions: [] });
    }
  };

  const toggleGameActive = async (game: ClassroomGame, nextActive: boolean) => {
    if (currentUser.role !== 'teacher') return;

    try {
      const res = await fetch(`/api/classes/${classroom.id}/games/${game.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: currentUser.id, isActive: nextActive })
      });

      if (!res.ok) {
        const message = await getBackendErrorMessage(res, 'ไม่สามารถอัปเดตสถานะเกมได้');
        showToast('error', message);
        return;
      }

      const updated = (await res.json()) as ClassroomGame;
      setGames((prev) => prev.map((item) => ({
        ...item,
        is_active: item.id === updated.id ? !!updated.is_active : (nextActive ? false : !!item.is_active)
      })));

      showToast('success', nextActive ? 'เปิดเกมให้นักเรียนเล่นแล้ว' : 'ปิดเกมแล้ว');
    } catch (error) {
      console.error('Failed to toggle game active state', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างอัปเดตสถานะเกม');
    }
  };

  const addQuestionDraft = () => {
    const normalizedQuestion = questionDraft.questionText.trim();
    const normalizedA = questionDraft.choiceA.trim();
    const normalizedB = questionDraft.choiceB.trim();
    const normalizedC = questionDraft.choiceC.trim();
    const normalizedD = questionDraft.choiceD.trim();

    if (!normalizedQuestion || !normalizedA || !normalizedB || !normalizedC || !normalizedD) {
      showToast('error', 'กรอกคำถามและตัวเลือกให้ครบก่อนเพิ่มคำถาม');
      return;
    }

    setGameQuestionsDraft((prev) => [
      ...prev,
      {
        questionText: normalizedQuestion,
        choiceA: normalizedA,
        choiceB: normalizedB,
        choiceC: normalizedC,
        choiceD: normalizedD,
        correctChoice: questionDraft.correctChoice
      }
    ]);
    setQuestionDraft({ questionText: '', choiceA: '', choiceB: '', choiceC: '', choiceD: '', correctChoice: 'A' });
  };

  const removeQuestionDraft = (index: number) => {
    setGameQuestionsDraft((prev) => prev.filter((_, idx) => idx !== index));
  };

  const submitGameAnswer = async () => {
    if (currentUser.role !== 'student') return;
    if (!activeGamePayload.game) return;
    if (!selectedChoice) {
      showToast('error', 'กรุณาเลือกคำตอบก่อนส่ง');
      return;
    }

    const currentQuestion = activeGamePayload.questions[activeQuestionIndex];
    if (!currentQuestion) return;

    setIsSubmittingAnswer(true);
    try {
      const res = await fetch(`/api/classes/${classroom.id}/games/${activeGamePayload.game.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          questionId: currentQuestion.id,
          choice: selectedChoice
        })
      });

      if (!res.ok) {
        const message = await getBackendErrorMessage(res, 'ส่งคำตอบไม่สำเร็จ');
        showToast('error', message);
        return;
      }

      const result = await res.json();
      setMyQuestScore(Number(result?.score?.score || myQuestScore));
      setMyQuestStreak(Number(result?.score?.streak || myQuestStreak));
      setMyQuestBestStreak(Number(result?.score?.best_streak || myQuestBestStreak));

      showToast('success', result.correct ? 'ตอบถูก! +10 คะแนน' : `ตอบผิด ข้อที่ถูกคือ ${result.correctChoice}`);

      const nextIndex = activeQuestionIndex + 1;
      if (nextIndex >= activeGamePayload.questions.length) {
        showToast('success', 'จบเกมแล้ว! รอครูเปิดเกมรอบใหม่ได้เลย');
        setActiveQuestionIndex(0);
      } else {
        setActiveQuestionIndex(nextIndex);
      }

      setSelectedChoice(null);
      setTimeLeft(Number(activeGamePayload.game?.time_limit_sec || 0));
    } catch (error) {
      console.error('Failed to submit answer', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างส่งคำตอบ');
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const startEditStudent = (student: User) => {
    setEditingStudentId(student.id);
    setStudentForm({
      name: student.name,
      student_id: student.student_id || '',
      bio: student.bio || ''
    });
  };

  const cancelEditStudent = () => {
    setEditingStudentId(null);
    setStudentForm({ name: '', student_id: '', bio: '' });
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  };

  const getBackendErrorMessage = async (res: Response, fallback: string) => {
    try {
      const data = await res.json();
      if (data?.error && typeof data.error === 'string') {
        return data.error;
      }
    } catch (error) {
      // Ignore JSON parsing errors and fallback to generic message.
    }
    return fallback;
  };

  const armUndoTimer = () => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);

    setUndoSecondsLeft(UNDO_SECONDS);
    undoIntervalRef.current = setInterval(() => {
      setUndoSecondsLeft((prev) => {
        if (prev <= 1) {
          if (undoIntervalRef.current) {
            clearInterval(undoIntervalRef.current);
            undoIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    undoTimeoutRef.current = setTimeout(() => {
      clearUndoState();
    }, UNDO_SECONDS * 1000);
  };

  const clearUndoState = () => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    if (undoIntervalRef.current) {
      clearInterval(undoIntervalRef.current);
      undoIntervalRef.current = null;
    }
    setUndoStudent(null);
    setUndoSecondsLeft(0);
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setStudentSearch(studentSearchInput);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [studentSearchInput]);

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
      if (undoIntervalRef.current) {
        clearInterval(undoIntervalRef.current);
      }
    };
  }, []);

  const saveStudent = async () => {
    if (!editingStudentId) return;
    setIsSavingStudent(true);

    try {
      const res = await fetch(`/api/classes/${classroom.id}/students/${editingStudentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...studentForm, actorId: currentUser.id })
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถบันทึกข้อมูลนักเรียนได้');
        showToast('error', errorMessage);
        return;
      }

      const updated = await res.json();
      setClassStudents(prev => prev.map(s => (s.id === updated.id ? updated : s)));
      cancelEditStudent();
      showToast('success', 'บันทึกข้อมูลนักเรียนเรียบร้อย');
    } catch (error) {
      console.error('Failed to update student', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูลนักเรียน');
    } finally {
      setIsSavingStudent(false);
    }
  };

  const removeStudentFromClass = async (student: User) => {
    const confirmed = window.confirm(`ลบนักเรียน ${student.name} ออกจากชั้นเรียนนี้?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/classes/${classroom.id}/students/${student.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: currentUser.id })
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถลบนักเรียนออกจากชั้นเรียนได้');
        showToast('error', errorMessage);
        return;
      }

      setClassStudents(prev => prev.filter(s => s.id !== student.id));
      if (editingStudentId === student.id) {
        cancelEditStudent();
      }
      showToast('success', `ลบ ${student.name} ออกจากชั้นเรียนแล้ว`);
      setUndoStudent(student);
      armUndoTimer();
    } catch (error) {
      console.error('Failed to remove student', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างลบนักเรียน');
    }
  };

  const restoreStudentToClass = async () => {
    if (!undoStudent) return;

    try {
      const res = await fetch(`/api/classes/${classroom.id}/students/${undoStudent.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: currentUser.id })
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถกู้คืนนักเรียนได้');
        showToast('error', errorMessage);
        return;
      }

      const data = await res.json();
      const restored = data.student as User;
      setClassStudents(prev => {
        if (prev.some(s => s.id === restored.id)) return prev;
        return [...prev, restored].sort((a, b) => a.name.localeCompare(b.name));
      });

      showToast('success', `กู้คืน ${restored.name} กลับเข้าชั้นแล้ว`);
      clearUndoState();
    } catch (error) {
      console.error('Failed to restore student', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างกู้คืนนักเรียน');
    }
  };

  const addStudentToClass = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedStudentId = addStudentForm.student_id.trim();
    const normalizedFullName = addStudentForm.full_name.trim().replace(/\s+/g, ' ');

    if (!normalizedStudentId || !normalizedFullName) {
      showToast('error', 'กรุณากรอกรหัสนักศึกษาและชื่อ-สกุล');
      return;
    }

    if (!/^\d{11}$/.test(normalizedStudentId)) {
      showToast('error', 'รหัสนักศึกษาต้องเป็นตัวเลข 11 หลัก เช่น 68219100001');
      return;
    }

    setIsAddingStudent(true);
    try {
      const res = await fetch(`/api/classes/${classroom.id}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: currentUser.id,
          studentId: normalizedStudentId,
          fullName: normalizedFullName
        })
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถเพิ่มนักเรียนเข้าชั้นได้');
        showToast('error', errorMessage);
        return;
      }

      const data = await res.json();
      const student = data.student as User;
      setClassStudents(prev => {
        const exists = prev.some(s => s.id === student.id);
        const next = exists ? prev.map(s => (s.id === student.id ? student : s)) : [...prev, student];
        return [...next].sort((a, b) => a.name.localeCompare(b.name));
      });

      setAddStudentForm({ student_id: '', full_name: '' });
      setIsAddStudentOpen(false);
      showToast('success', 'เพิ่มนักเรียนเข้าชั้นเรียนแล้ว');
      clearUndoState();
    } catch (error) {
      console.error('Failed to add student', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างเพิ่มนักเรียน');
    } finally {
      setIsAddingStudent(false);
    }
  };

  const importStudentsFromExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';
    setIsImportingStudents(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        showToast('error', 'ไม่พบชีตข้อมูลในไฟล์ Excel');
        return;
      }

      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[firstSheetName], {
        header: 1,
        raw: false,
        defval: ''
      });

      const payloadRows: Array<{ studentId: string; fullName: string; rowNumber: number }> = [];
      rows.forEach((row, index) => {
        const studentId = String(row[0] ?? '').trim();
        const fullName = String(row[1] ?? '').trim().replace(/\s+/g, ' ');
        const isHeader = index === 0 && (studentId.includes('รหัส') || fullName.includes('ชื่อ'));

        if (isHeader) return;
        if (!studentId && !fullName) return;
        payloadRows.push({ studentId, fullName, rowNumber: index + 1 });
      });

      if (payloadRows.length === 0) {
        showToast('error', 'ไม่พบข้อมูลนักเรียนในไฟล์ (คอลัมน์ A: รหัสนักศึกษา, B: ชื่อ-สกุล)');
        return;
      }

      const addedStudents: User[] = [];
      const failed: string[] = [];

      for (const row of payloadRows) {
        if (!/^\d{11}$/.test(row.studentId)) {
          failed.push(`แถว ${row.rowNumber}: รหัสนักศึกษาไม่ถูกต้อง (${row.studentId || '-'})`);
          continue;
        }
        if (!row.fullName) {
          failed.push(`แถว ${row.rowNumber}: กรุณาระบุชื่อ-สกุล`);
          continue;
        }

        const res = await fetch(`/api/classes/${classroom.id}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: currentUser.id,
            studentId: row.studentId,
            fullName: row.fullName
          })
        });

        if (!res.ok) {
          const message = await getBackendErrorMessage(res, 'ไม่สามารถเพิ่มนักเรียนเข้าชั้นได้');
          failed.push(`แถว ${row.rowNumber}: ${message}`);
          continue;
        }

        const data = await res.json();
        addedStudents.push(data.student as User);
      }

      if (addedStudents.length > 0) {
        setClassStudents(prev => {
          const map = new Map<number, User>(prev.map(student => [student.id, student]));
          addedStudents.forEach(student => map.set(student.id, student));
          return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
        });
        clearUndoState();
      }

      showToast(
        failed.length === 0 ? 'success' : 'error',
        `นำเข้าเสร็จแล้ว: สำเร็จ ${addedStudents.length} รายการ, ไม่สำเร็จ ${failed.length} รายการ`
      );

      if (failed.length > 0) {
        showToast('error', `ตัวอย่างข้อผิดพลาด: ${failed.slice(0, 2).join(' | ')}`);
      }
    } catch (error) {
      console.error('Failed to import students from excel', error);
      showToast('error', 'อ่านไฟล์ Excel ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์');
    } finally {
      setIsImportingStudents(false);
    }
  };

  const downloadStudentExcelTemplate = () => {
    const templateRows = [
      ['รหัสนักศึกษา', 'ชื่อ-สกุล'],
      ['68219100001', 'นายตัวอย่าง ใจดี'],
      ['68219100002', 'นางสาวตัวอย่าง ตั้งใจ']
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(templateRows);
    worksheet['!cols'] = [{ wch: 18 }, { wch: 36 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'students');
    XLSX.writeFile(workbook, 'student-import-template.xlsx');
    showToast('success', 'ดาวน์โหลดเทมเพลต Excel แล้ว');
  };

  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const getAssignmentsForDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    return assignments.filter(ass => ass.due_date === dateString);
  };

  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));

  const postAnnouncement = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = new FormData(e.currentTarget).get('content') as string;
    if (!content) return;

    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: classroom.id, content })
    });

    if (res.ok) {
      e.currentTarget.reset();
      fetchClassData();
    }
  };

  const generateAssignmentWithAi = async () => {
    setIsAiGenerating(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `สร้างงานที่สร้างสรรค์สำหรับชั้นเรียนชื่อ "${classroom.name}". 
        คำอธิบายชั้นเรียนคือ: "${classroom.description}".
        ส่งคืนผลลัพธ์เป็นวัตถุ JSON ที่มีฟิลด์ "title" และ "description" เป็นภาษาไทย`,
        config: { responseMimeType: "application/json" }
      });
      
      const data = JSON.parse(response.text);
      
      await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          classId: classroom.id, 
          title: data.title, 
          description: data.description,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        })
      });
      
      fetchClassData();
    } catch (error) {
      console.error("AI Generation failed", error);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const focusFirstFilteredStudent = () => {
    window.requestAnimationFrame(() => {
      if (!firstFilteredStudentRef.current) return;
      firstFilteredStudentRef.current.focus();
      firstFilteredStudentRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const handleStudentSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setStudentSearch(studentSearchInput);
    setTimeout(() => focusFirstFilteredStudent(), 0);
  };

  const filteredStudents = classStudents.filter((student) => {
    const query = studentSearch.trim().toLowerCase();
    if (!query) return true;

    return (
      student.name.toLowerCase().includes(query) ||
      (student.student_id || '').toLowerCase().includes(query) ||
      (student.email || '').toLowerCase().includes(query)
    );
  });
  const setStudentAttendance = (studentId: number, status: AttendanceStatus) => {
    setAttendanceByStudent((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = () => {
    if (currentUser.role !== 'teacher') return;
    const next: Record<number, AttendanceStatus> = {};
    classStudents.forEach((student) => {
      next[student.id] = 'present';
    });
    setAttendanceByStudent(next);
    showToast('success', 'เช็คชื่อทั้งหมดเป็น "มา" แล้ว');
  };

  const saveAttendance = async () => {
    if (currentUser.role !== 'teacher') {
      showToast('error', 'เฉพาะครูเท่านั้นที่บันทึกเช็คชื่อได้');
      return;
    }

    if (classStudents.length === 0) {
      showToast('error', 'ยังไม่มีนักเรียนในชั้นเรียนนี้');
      return;
    }

    const unmarkedStudents = classStudents.filter((student) => !attendanceByStudent[student.id]);
    if (unmarkedStudents.length > 0) {
      showToast('error', `ยังเช็คชื่อไม่ครบ เหลือ ${unmarkedStudents.length} คน`);
      return;
    }

    const records = classStudents.map((student) => ({
      studentId: student.id,
      status: attendanceByStudent[student.id] as AttendanceStatus
    }));

    setIsSavingAttendance(true);
    try {
      const res = await fetch(`/api/classes/${classroom.id}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: currentUser.id,
          date: attendanceDate,
          records
        })
      });

      if (!res.ok) {
        const errorMessage = await getBackendErrorMessage(res, 'ไม่สามารถบันทึกการเช็คชื่อได้');
        showToast('error', errorMessage);
        return;
      }

      showToast('success', `บันทึกเช็คชื่อวันที่ ${attendanceDate} เรียบร้อย`);
    } catch (error) {
      console.error('Failed to save attendance', error);
      showToast('error', 'เกิดข้อผิดพลาดระหว่างบันทึกเช็คชื่อ');
    } finally {
      setIsSavingAttendance(false);
    }
  };

  const exportDailyAttendanceToExcel = () => {
    if (classStudents.length === 0) {
      showToast('error', 'ยังไม่มีข้อมูลนักเรียนให้ส่งออก');
      return;
    }

    const statusMap: Record<AttendanceStatus, string> = {
      present: 'มา',
      late: 'สาย',
      absent: 'ขาด'
    };

    const rows = classStudents.map((student) => {
      const status = attendanceByStudent[student.id];
      return [student.student_id || '-', student.name, status ? statusMap[status] : 'ยังไม่เช็ค'];
    });

    const sheetData = [
      ['วันที่', attendanceDate, '', ''],
      ['สรุป', `มา ${presentCount} คน`, `สาย ${lateCount} คน`, `ขาด ${absentCount} คน`],
      ['รหัสนักศึกษา', 'ชื่อ-สกุล', 'สถานะ', 'หมายเหตุ'],
      ...rows
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    worksheet['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 22 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'attendance-daily');
    XLSX.writeFile(workbook, `attendance-${classroom.code}-${attendanceDate}.xlsx`);
    showToast('success', 'ส่งออกสรุปเช็คชื่อรายวันเป็น Excel แล้ว');
  };

  const presentCount = classStudents.filter((student) => attendanceByStudent[student.id] === 'present').length;
  const lateCount = classStudents.filter((student) => attendanceByStudent[student.id] === 'late').length;
  const absentCount = classStudents.filter((student) => attendanceByStudent[student.id] === 'absent').length;
  const unmarkedCount = classStudents.filter((student) => !attendanceByStudent[student.id]).length;

  const getAttendanceRatePercent = (row: MonthlyAttendanceSummary) => {
    if (row.checked_count <= 0) return 0;
    return ((row.present_count + row.late_count) / row.checked_count) * 100;
  };

  const monthlyReportQuery = monthlyReportSearch.trim().toLowerCase();
  const filteredMonthlyReportRows = monthlyReportRows.filter((row) => {
    if (!monthlyReportQuery) return true;
    return (
      row.student_name.toLowerCase().includes(monthlyReportQuery) ||
      (row.student_code || '').toLowerCase().includes(monthlyReportQuery)
    );
  });

  const sortedMonthlyReportRows = [...filteredMonthlyReportRows].sort((a, b) => {
    const rateA = getAttendanceRatePercent(a);
    const rateB = getAttendanceRatePercent(b);
    if (rateA === rateB) {
      return a.student_name.localeCompare(b.student_name);
    }
    return monthlyRateSort === 'desc' ? rateB - rateA : rateA - rateB;
  });
  const undoProgressPercent = Math.max(0, Math.min(100, (undoSecondsLeft / UNDO_SECONDS) * 100));

  const parseGradeValue = (raw?: string) => {
    if (!raw) return null;
    const match = String(raw).match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  };

  const gradedAssignments = assignments.filter((ass) => ass.submission_status === 'graded');
  const gradedScoreValues = gradedAssignments
    .map((ass) => parseGradeValue(ass.grade))
    .filter((score): score is number => score !== null);
  const totalScore = gradedScoreValues.reduce((sum, score) => sum + score, 0);
  const averageScore = gradedScoreValues.length > 0 ? totalScore / gradedScoreValues.length : 0;
  const submittedCount = assignments.filter((ass) => !!ass.submission_status).length;
  const submissionPercent = assignments.length > 0 ? (submittedCount / assignments.length) * 100 : 0;

  useEffect(() => {
    if (currentUser.role === 'student' && tab === 'stream') {
      setTab('classwork');
    }
  }, [currentUser.role, tab]);

  useEffect(() => {
    if (currentUser.role !== 'student') return;
    fetchMyQuestScore();
  }, [classroom.id, currentUser.id, currentUser.role]);

  useEffect(() => {
    if (currentUser.role !== 'student') return;
    if (tab !== 'classwork') return;
    fetchActiveGame();
  }, [classroom.id, currentUser.id, currentUser.role, tab]);

  useEffect(() => {
    if (currentUser.role !== 'student') return;
    if (tab !== 'classwork') return;
    if (!activeGamePayload.game || activeGamePayload.questions.length === 0) return;
    if (isSubmittingAnswer) return;
    if (timeLeft <= 0) return;

    const timerId = window.setTimeout(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearTimeout(timerId);
  }, [timeLeft, activeGamePayload.game?.id, activeGamePayload.questions.length, currentUser.role, tab, isSubmittingAnswer]);

  useEffect(() => {
    if (currentUser.role !== 'student') return;
    if (timeLeft > 0) return;
    if (!activeGamePayload.game) return;
    if (activeGamePayload.questions.length === 0) return;
    if (isSubmittingAnswer) return;

    const nextIndex = activeQuestionIndex + 1;
    showToast('error', 'หมดเวลา ข้ามไปข้อถัดไป');
    if (nextIndex >= activeGamePayload.questions.length) {
      setActiveQuestionIndex(0);
    } else {
      setActiveQuestionIndex(nextIndex);
    }
    setSelectedChoice(null);
    setTimeLeft(Number(activeGamePayload.game.time_limit_sec || 0));
  }, [timeLeft]);

  const myQuestTier = getQuestTier(myQuestScore);
  const activeQuestions = activeGamePayload.questions;
  const activeQuestion = activeQuestions[activeQuestionIndex] || null;
  const totalActiveQuestions = activeQuestions.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-slate-500 hover:text-pink-600 transition-colors font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        กลับไปยังหน้าหลัก
      </button>

      <div className={`relative h-48 rounded-3xl overflow-hidden bg-gradient-to-br ${classTheme.cardBg} border ${classTheme.border} flex items-end p-8 shadow-sm`}>
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top_right,_#ffffff,_transparent)]"></div>
        <div className="relative z-10 text-slate-900">
          <div className="flex items-center gap-3 mb-2">
            <span className={`w-3 h-3 rounded-full ${classTheme.dot}`} />
            <h2 className="text-4xl font-bold">{classroom.name}</h2>
          </div>
          <div className="flex items-center gap-4 text-slate-500 font-medium">
            <span className="flex items-center gap-1.5">
              <Users className={`w-4 h-4 ${classTheme.iconText}`} />
              รหัสชั้นเรียน: {classroom.code}
            </span>
          </div>
        </div>

        {currentUser.role === 'student' && (
          <div className="absolute top-4 right-4 z-10 bg-white/75 backdrop-blur-md rounded-2xl border border-slate-200 p-3 w-[180px] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-slate-700">คะแนนเก็บของฉัน</p>
              <Award className="w-4 h-4 text-amber-500" />
            </div>

            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full grid place-items-center text-[11px] font-bold text-pink-700"
                style={{
                  background: `conic-gradient(#ec4899 ${Math.max(0, Math.min(100, averageScore))}%, #e2e8f0 0)`
                }}
              >
                <span className="w-9 h-9 rounded-full bg-white grid place-items-center">{Math.round(averageScore)}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">เฉลี่ย</p>
                <p className="text-sm font-bold text-slate-800">{averageScore.toFixed(1)} / 100</p>
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-slate-500">รวมคะแนน: <span className="font-semibold text-slate-700">{totalScore.toFixed(1)}</span></p>
              <p className="text-[11px] text-slate-500">ส่งงานแล้ว: <span className="font-semibold text-slate-700">{submittedCount}/{assignments.length}</span> ({submissionPercent.toFixed(0)}%)</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex border-b border-slate-200/50">
        {[
          { id: 'stream', label: 'ประกาศใหม่' },
          { id: 'classwork', label: 'งานของชั้นเรียน' },
          { id: 'attendance', label: 'เช็คชื่อ' },
          { id: 'people', label: 'นักเรียน' }
        ]
          .filter((t) => !(currentUser.role === 'student' && t.id === 'stream'))
          .map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`px-8 py-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
              tab === t.id ? 'text-pink-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
            {tab === t.id && (
              <motion.div 
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-1 bg-pink-500 shadow-lg shadow-pink-200"
              />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {tab === 'stream' && currentUser.role === 'teacher' && (
          <>
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
                <form onSubmit={postAnnouncement} className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-pink-500/10 flex items-center justify-center shrink-0">
                      <UserIcon className="w-5 h-5 text-pink-500" />
                    </div>
                    <textarea 
                      name="content"
                      placeholder="ประกาศบางอย่างในชั้นเรียนของคุณ..."
                      className="w-full bg-white/60 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-pink-500 outline-none min-h-[100px] text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="bg-pink-600 text-white px-6 py-2 rounded-xl font-semibold hover:bg-pink-500 transition-all shadow-md shadow-pink-100">
                      โพสต์
                    </button>
                  </div>
                </form>
              </div>

              <div className="space-y-4">
                {announcements.map((ann) => (
                  <div key={ann.id} className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                        <UserIcon className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-slate-900">ครู</p>
                        <p className="text-xs text-slate-400">{new Date(ann.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <p className="text-slate-600 whitespace-pre-wrap">{ann.content}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
                <h3 className="font-bold mb-4 flex items-center gap-2 text-slate-900">
                  <ClipboardList className="w-5 h-5 text-pink-500" />
                  เร็วๆ นี้
                </h3>
                <div className="space-y-4">
                  {assignments.slice(0, 3).map(ass => (
                    <div key={ass.id} className="group cursor-pointer">
                      <p className="text-sm font-semibold group-hover:text-pink-600 transition-colors text-slate-700">{ass.title}</p>
                      <p className="text-xs text-slate-400">กำหนดส่ง {ass.due_date}</p>
                    </div>
                  ))}
                  {assignments.length === 0 && <p className="text-sm text-slate-400 italic">ไม่มีงานที่ต้องส่ง</p>}
                </div>
              </div>

              {currentUser.role === 'teacher' && (
                <div className="bg-white/60 backdrop-blur-md rounded-2xl p-6 shadow-xl text-slate-900 border border-pink-200 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Sparkles className="w-20 h-20 text-pink-500" />
                  </div>
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-pink-500" />
                    ผู้ช่วย AI
                  </h3>
                  <p className="text-slate-500 text-sm mb-4">ต้องการแรงบันดาลใจ? ให้ AI ช่วยสร้างงานที่สร้างสรรค์สำหรับชั้นเรียนนี้</p>
                  <button 
                    onClick={generateAssignmentWithAi}
                    disabled={isAiGenerating}
                    className="w-full bg-pink-600 text-white py-2.5 rounded-xl font-bold hover:bg-pink-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-pink-100"
                  >
                    {isAiGenerating ? "กำลังสร้าง..." : "สร้างงานด้วย AI"}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'classwork' && (
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/60 bg-white/40 p-2">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  onClick={() => setClassworkMenu('assignments')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${classworkMenu === 'assignments' ? 'bg-white text-pink-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  งาน
                </button>
                <button
                  onClick={() => setClassworkMenu('game')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${classworkMenu === 'game' ? 'bg-white text-pink-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  เกม
                </button>
              </div>
            </div>

            {currentUser.role === 'student' && (
              <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
                {classworkMenu === 'game' ? (
                  <div className="mb-5 rounded-3xl border-2 border-[#BCA6DC] bg-[#EDE4F8] p-4 shadow-[0_10px_20px_rgba(90,58,130,0.14)]">
                    <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr_180px]">
                      <div className="rounded-2xl border-2 border-[#8E73B1] bg-[#C7B7EB] px-4 py-3 text-center text-2xl font-black text-[#2F1D4A]">
                        KEYFRAME QUEST
                      </div>
                      <div className="rounded-2xl border-2 border-[#8ECDB4] bg-[#BDEAD6] px-4 py-3 text-center">
                        <p className="text-base font-black text-[#25324A]">{activeGamePayload.game?.title || 'รอครูเปิดเกม'}</p>
                        <p className="text-sm font-bold text-[#34435F]">
                          {activeQuestion ? `Q ${activeQuestionIndex + 1}/${Math.max(totalActiveQuestions, Number(activeGamePayload.game?.total_questions || totalActiveQuestions || 1))}` : 'Q 0/0'}
                        </p>
                      </div>
                      <div className="rounded-2xl border-2 border-[#A886D6] bg-[#DCC9F8] px-4 py-3 text-center">
                        <p className="text-2xl font-black text-[#2F1D4A]">TIMER: {timeLeft}s</p>
                      </div>
                    </div>

                    {activeQuestion ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border-2 border-[#A893C8] bg-white px-5 py-4">
                          <p className="text-3xl font-extrabold text-[#20263A]">Q {activeQuestionIndex + 1}: {activeQuestion.question_text}</p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {([
                            { key: 'A', label: activeQuestion.choice_a, box: 'bg-[#F7C7A8]' },
                            { key: 'B', label: activeQuestion.choice_b, box: 'bg-[#BFEEDF]' },
                            { key: 'C', label: activeQuestion.choice_c, box: 'bg-[#D7F6A6]' },
                            { key: 'D', label: activeQuestion.choice_d, box: 'bg-[#D4C5F4]' }
                          ] as const).map((choiceItem) => {
                            const isSelected = selectedChoice === choiceItem.key;
                            return (
                              <button
                                key={choiceItem.key}
                                onClick={() => setSelectedChoice(choiceItem.key)}
                                className={`rounded-2xl border-2 px-4 py-4 text-left text-2xl font-black text-[#1F2638] transition-all ${choiceItem.box} ${isSelected ? 'border-[#EC2D8B] ring-4 ring-pink-200 scale-[1.01]' : 'border-[#9A83BE] hover:border-[#7F65A9]'}`}
                              >
                                {choiceItem.key}. {choiceItem.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#CDBCE6] bg-white/70 px-4 py-3">
                          <p className="text-sm font-bold text-[#5B466F]">{myQuestTier.icon} {myQuestTier.label} • คะแนน {myQuestScore} • Streak {myQuestStreak} • Best {myQuestBestStreak}</p>
                          <button
                            onClick={submitGameAnswer}
                            disabled={!selectedChoice || isSubmittingAnswer}
                            className="rounded-xl bg-[#EC2D8B] px-5 py-2 text-sm font-extrabold text-white hover:brightness-95 disabled:opacity-60"
                          >
                            {isSubmittingAnswer ? 'กำลังส่งคำตอบ...' : 'ยืนยันคำตอบ'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border-2 border-dashed border-[#BCA6DC] bg-white/80 px-4 py-10 text-center">
                        <p className="text-lg font-extrabold text-[#5B466F]">ยังไม่มีเกมที่เปิดอยู่</p>
                        <p className="mt-1 text-sm font-semibold text-[#7F6B98]">รอครูเปิดเกม แล้วกลับมาหน้านี้เพื่อเริ่มเล่น</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <h4 className="text-lg font-bold text-slate-900 mb-3">โพสต์จากครู</h4>
                    <div className="space-y-3">
                      {announcements.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">ยังไม่มีโพสต์จากครู</p>
                      ) : (
                        announcements.map((ann) => (
                          <div key={ann.id} className="bg-white/70 rounded-xl border border-slate-100 p-4">
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{ann.content}</p>
                            <p className="text-xs text-slate-400 mt-2">{new Date(ann.created_at).toLocaleDateString()}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h3 className="text-2xl font-bold text-slate-900">{classworkMenu === 'assignments' ? 'งานของชั้นเรียน' : 'เกมทบทวน'}</h3>
                {classworkMenu === 'assignments' && (
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button 
                      onClick={() => setViewMode('list')}
                      className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white text-pink-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      รายการ
                    </button>
                    <button 
                      onClick={() => setViewMode('calendar')}
                      className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-pink-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      ปฏิทิน
                    </button>
                  </div>
                )}
              </div>
              {currentUser.role === 'teacher' && classworkMenu === 'game' && (
                <button
                  onClick={() => setIsCreateGameOpen((prev) => !prev)}
                  className="flex items-center gap-2 bg-pink-600 text-white px-5 py-2 rounded-xl font-semibold hover:bg-pink-500 transition-all shadow-md shadow-pink-100"
                >
                  <Plus className="w-5 h-5" />
                  {isCreateGameOpen ? 'ปิดฟอร์มเกม' : 'สร้างเกม'}
                </button>
              )}
            </div>

            {currentUser.role === 'teacher' && classworkMenu === 'game' && isCreateGameOpen && (
              <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
                <h4 className="text-lg font-bold text-slate-900 mb-4">สร้างเกมใหม่ในวิชานี้</h4>
                <form onSubmit={createGame} className="space-y-3">
                  <input
                    value={gameForm.title}
                    onChange={(e) => setGameForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-900"
                    placeholder="ชื่อเกม (เช่น Keyframe Quest - บทที่ 1)"
                    required
                  />
                  <textarea
                    value={gameForm.description}
                    onChange={(e) => setGameForm((prev) => ({ ...prev, description: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 h-24"
                    placeholder="คำอธิบายเกม/หัวข้อที่ทบทวน"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={gameForm.total_questions}
                      onChange={(e) => setGameForm((prev) => ({ ...prev, total_questions: e.target.value }))}
                      className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-900"
                      placeholder="จำนวนข้อ"
                    />
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={gameForm.time_limit_sec}
                      onChange={(e) => setGameForm((prev) => ({ ...prev, time_limit_sec: e.target.value }))}
                      className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-900"
                      placeholder="เวลา/ข้อ (วินาที)"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-3">
                    <p className="text-sm font-bold text-slate-800">เพิ่มคำถามเกม</p>
                    <textarea
                      value={questionDraft.questionText}
                      onChange={(e) => setQuestionDraft((prev) => ({ ...prev, questionText: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200"
                      placeholder="คำถาม"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input value={questionDraft.choiceA} onChange={(e) => setQuestionDraft((prev) => ({ ...prev, choiceA: e.target.value }))} className="px-3 py-2 rounded-lg border border-slate-200" placeholder="ตัวเลือก A" />
                      <input value={questionDraft.choiceB} onChange={(e) => setQuestionDraft((prev) => ({ ...prev, choiceB: e.target.value }))} className="px-3 py-2 rounded-lg border border-slate-200" placeholder="ตัวเลือก B" />
                      <input value={questionDraft.choiceC} onChange={(e) => setQuestionDraft((prev) => ({ ...prev, choiceC: e.target.value }))} className="px-3 py-2 rounded-lg border border-slate-200" placeholder="ตัวเลือก C" />
                      <input value={questionDraft.choiceD} onChange={(e) => setQuestionDraft((prev) => ({ ...prev, choiceD: e.target.value }))} className="px-3 py-2 rounded-lg border border-slate-200" placeholder="ตัวเลือก D" />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <select
                        value={questionDraft.correctChoice}
                        onChange={(e) => setQuestionDraft((prev) => ({ ...prev, correctChoice: e.target.value as 'A' | 'B' | 'C' | 'D' }))}
                        className="px-3 py-2 rounded-lg border border-slate-200"
                      >
                        <option value="A">คำตอบที่ถูก: A</option>
                        <option value="B">คำตอบที่ถูก: B</option>
                        <option value="C">คำตอบที่ถูก: C</option>
                        <option value="D">คำตอบที่ถูก: D</option>
                      </select>
                      <button type="button" onClick={addQuestionDraft} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white hover:bg-slate-600">
                        เพิ่มคำถาม
                      </button>
                    </div>

                    {gameQuestionsDraft.length > 0 && (
                      <div className="space-y-2">
                        {gameQuestionsDraft.map((item, idx) => (
                          <div key={`${item.questionText}-${idx}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">ข้อ {idx + 1}: {item.questionText}</p>
                              <p className="text-xs text-slate-500">เฉลย: {item.correctChoice}</p>
                            </div>
                            <button type="button" onClick={() => removeQuestionDraft(idx)} className="text-xs font-bold text-rose-600 hover:text-rose-500">ลบ</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isCreatingGame}
                    className="bg-pink-600 text-white px-5 py-2 rounded-xl font-semibold hover:bg-pink-500 transition-all shadow-md shadow-pink-100 disabled:opacity-60"
                  >
                    {isCreatingGame ? 'กำลังสร้างเกม...' : 'บันทึกเกม'}
                  </button>
                </form>
              </div>
            )}

            {classworkMenu === 'game' && (
              <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
                <h4 className="text-lg font-bold text-slate-900 mb-3">เกมทบทวนในวิชานี้</h4>
                {games.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">ยังไม่มีเกมในวิชานี้</p>
                ) : (
                  <div className="space-y-3">
                    {games.map((game) => (
                      <div key={game.id} className="bg-white/70 rounded-xl border border-slate-100 p-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{game.title}</p>
                          <p className="text-xs text-slate-500 mt-1">{game.description || 'เกมทบทวนบทเรียน'}</p>
                          <p className="text-[11px] text-slate-400 mt-1">{game.total_questions} ข้อ • {game.time_limit_sec} วินาที/ข้อ</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {currentUser.role === 'teacher' && (
                            <button
                              onClick={() => toggleGameActive(game, !game.is_active)}
                              className={`text-[11px] rounded-full px-3 py-1 font-bold ${game.is_active ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}
                            >
                              {game.is_active ? 'ปิดเกม' : 'เปิดเกม'}
                            </button>
                          )}
                          <span className={`text-[11px] rounded-full px-2.5 py-1 font-bold ${game.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                            {game.is_active ? 'กำลังเล่น' : 'ยังไม่เริ่ม'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {classworkMenu === 'assignments' && (viewMode === 'list' ? (
              <div className="space-y-4">
                {assignments.map((ass) => {
                  const isSubmitted = !!ass.submission_status;
                  const isGraded = ass.submission_status === 'graded';
                  const isLate = isSubmitted && ass.submitted_at && new Date(ass.submitted_at) > new Date(ass.due_date);
                  const isOverdue = new Date(ass.due_date) < new Date() && !isSubmitted;
                  
                  return (
                    <div key={ass.id} className="bg-white/40 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm hover:border-pink-300 transition-all cursor-pointer flex items-center justify-between group relative overflow-hidden">
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                        isGraded ? 'bg-emerald-500' : 
                        isLate ? 'bg-amber-500' :
                        isSubmitted ? 'bg-blue-500' : 
                        isOverdue ? 'bg-red-500' :
                        'bg-pink-500'
                      }`} />
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl transition-colors ${
                          isGraded ? 'bg-emerald-500/10 text-emerald-500' : 
                          isLate ? 'bg-amber-500/10 text-amber-500' :
                          isSubmitted ? 'bg-blue-500/10 text-blue-500' : 
                          isOverdue ? 'bg-red-500/10 text-red-500' :
                          'bg-pink-500/10 text-pink-500'
                        }`}>
                          {isGraded ? (
                            <Award className="w-6 h-6" />
                          ) : isLate ? (
                            <Clock className="w-6 h-6" />
                          ) : isSubmitted ? (
                            <CheckCircle2 className="w-6 h-6" />
                          ) : isOverdue ? (
                            <AlertCircle className="w-6 h-6" />
                          ) : (
                            <ClipboardList className="w-6 h-6" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              isGraded ? 'bg-emerald-500' : 
                              isLate ? 'bg-amber-500' :
                              isSubmitted ? 'bg-blue-500' : 
                              isOverdue ? 'bg-red-500' :
                              'bg-pink-500'
                            }`} />
                            <h4 className="font-bold text-lg text-slate-900 group-hover:text-pink-600 transition-colors">{ass.title}</h4>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-xs text-slate-400">โพสต์เมื่อ {new Date().toLocaleDateString()}</p>
                            {isGraded && (
                              <span className="text-[10px] bg-emerald-500 text-white px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm shadow-emerald-100">
                                <Award className="w-3 h-3" />
                                ให้คะแนนแล้ว: {ass.grade}
                              </span>
                            )}
                            {isLate && (
                              <span className="text-[10px] bg-amber-500 text-white px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm shadow-amber-100">
                                <Clock className="w-3 h-3" />
                                ส่งล่าช้า
                              </span>
                            )}
                            {isSubmitted && !isGraded && !isLate && (
                              <span className="text-[10px] bg-blue-500 text-white px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm shadow-blue-100">
                                <CheckCircle2 className="w-3 h-3" />
                                ส่งแล้ว
                              </span>
                            )}
                            {isOverdue && (
                              <span className="text-[10px] bg-red-500 text-white px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm shadow-red-100">
                                <AlertCircle className="w-3 h-3" />
                                เกินกำหนด
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end text-slate-500 mb-1">
                          <Clock className="w-3.5 h-3.5" />
                          <p className={`text-sm font-medium ${isOverdue ? 'text-red-500' : 'text-slate-500'}`}>
                            กำหนดส่ง {ass.due_date}
                          </p>
                        </div>
                        {!isSubmitted && !isOverdue && (
                          <p className="text-[10px] text-pink-500 font-bold uppercase tracking-wider">รอการส่ง</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {assignments.length === 0 && (
                  <div className="py-20 text-center text-slate-400">
                    <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>ยังไม่มีงาน</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-slate-200/50 p-8 shadow-sm">
                <div className="flex justify-between items-center mb-8">
                  <h4 className="text-xl font-bold text-slate-900">
                    {currentMonth.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
                  </h4>
                  <div className="flex gap-2">
                    <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                      <ChevronRight className="w-5 h-5 rotate-180" />
                    </button>
                    <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-2 mb-4">
                  {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map(day => (
                    <div key={day} className="text-center text-xs font-bold text-slate-400 uppercase tracking-wider py-2">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {generateCalendarDays().map((date, i) => {
                    if (!date) return <div key={`empty-${i}`} className="aspect-square" />;
                    const dayAssignments = getAssignmentsForDate(date);
                    const isSelected = selectedDate?.toDateString() === date.toDateString();
                    const isToday = new Date().toDateString() === date.toDateString();

                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => setSelectedDate(isSelected ? null : date)}
                        className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all border ${
                          isSelected 
                            ? 'bg-pink-600 text-white border-pink-600 shadow-lg shadow-pink-200' 
                            : isToday
                              ? 'bg-pink-100 text-pink-700 border-pink-300'
                              : dayAssignments.length > 0
                                ? 'bg-pink-50/40 border-pink-200 shadow-sm hover:bg-pink-50/60'
                                : 'bg-white/50 border-slate-100 hover:border-pink-300 hover:bg-white'
                        }`}
                      >
                        <span className={`text-sm font-bold ${dayAssignments.length > 0 && !isSelected && !isToday ? 'text-pink-600' : ''}`}>
                          {date.getDate()}
                        </span>
                        {dayAssignments.length > 0 && (
                          <div className="absolute top-2 right-2 flex gap-0.5">
                            {dayAssignments.slice(0, 3).map((_, idx) => (
                              <div key={idx} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-pink-500'}`} />
                            ))}
                            {dayAssignments.length > 3 && <span className={`text-[8px] leading-none ${isSelected ? 'text-white' : 'text-pink-500'}`}>+</span>}
                          </div>
                        )}
                        {dayAssignments.length > 0 && (
                          <div className={`w-1.5 h-1.5 rounded-full mt-1 ${isSelected ? 'bg-white' : 'bg-pink-500'}`} />
                        )}
                      </button>
                    );
                  })}
                </div>

                <AnimatePresence>
                  {selectedDate && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="mt-8 p-6 bg-slate-50 rounded-2xl border border-slate-100"
                    >
                      <h5 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-pink-500" />
                        งานที่ต้องส่งวันที่ {selectedDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </h5>
                      <div className="space-y-3">
                        {getAssignmentsForDate(selectedDate).map(ass => (
                          <div key={ass.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                            <span className="font-bold text-slate-700">{ass.title}</span>
                            <span className="text-xs text-slate-400">{ass.description?.substring(0, 30)}...</span>
                          </div>
                        ))}
                        {getAssignmentsForDate(selectedDate).length === 0 && (
                          <p className="text-sm text-slate-400 italic">ไม่มีงานที่ต้องส่งในวันนี้</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}

        {tab === 'attendance' && currentUser.role === 'teacher' && (
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-slate-200/50 p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">เช็คชื่อเข้าเรียน</h3>
                  <p className="text-sm text-slate-500 mt-1">เลือกวันที่และระบุสถานะของนักเรียนแต่ละคน</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="date"
                    value={attendanceDate}
                    onChange={(e) => setAttendanceDate(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
                  />
                  {currentUser.role === 'teacher' && (
                    <button
                      onClick={markAllPresent}
                      disabled={isAttendanceLoading || classStudents.length === 0}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-all disabled:opacity-60"
                    >
                      เช็คชื่อทั้งหมด = มา
                    </button>
                  )}
                  <button
                    onClick={exportDailyAttendanceToExcel}
                    disabled={classStudents.length === 0}
                    className="px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 transition-all disabled:opacity-60"
                  >
                    ส่งออกรายวันเป็น Excel
                  </button>
                  {currentUser.role === 'teacher' && (
                    <button
                      onClick={saveAttendance}
                      disabled={isSavingAttendance || isAttendanceLoading || classStudents.length === 0}
                      className="px-4 py-2 rounded-xl bg-pink-600 text-white text-sm font-semibold hover:bg-pink-500 transition-all disabled:opacity-60"
                    >
                      {isSavingAttendance ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <p className="text-xs text-emerald-700">มาเรียน</p>
                  <p className="text-xl font-bold text-emerald-700">{presentCount}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-700">มาสาย</p>
                  <p className="text-xl font-bold text-amber-700">{lateCount}</p>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <p className="text-xs text-rose-700">ขาด</p>
                  <p className="text-xl font-bold text-rose-700">{absentCount}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <p className="text-xs text-slate-600">ยังไม่เช็ค</p>
                  <p className="text-xl font-bold text-slate-700">{unmarkedCount}</p>
                </div>
              </div>
            </div>

            <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-slate-200/50 p-6 shadow-sm">
              {isAttendanceLoading ? (
                <p className="text-sm text-slate-500">กำลังโหลดข้อมูลการเช็คชื่อ...</p>
              ) : classStudents.length === 0 ? (
                <p className="text-sm text-slate-500">ยังไม่มีนักเรียนในชั้นเรียนนี้</p>
              ) : (
                <div className="space-y-4">
                  {classStudents.map((student) => {
                    const status = attendanceByStudent[student.id];
                    return (
                      <div key={student.id} className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 p-3 rounded-xl border border-slate-100 bg-white/60">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                            {student.profile_picture ? (
                              <img src={student.profile_picture} alt={student.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <UserIcon className="w-5 h-5 text-slate-300" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{student.name}</p>
                            <p className="text-xs text-slate-500">{student.student_id || 'ไม่มีรหัสนักศึกษา'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setStudentAttendance(student.id, 'present')}
                            disabled={currentUser.role !== 'teacher'}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${status === 'present' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'} disabled:opacity-60`}
                          >
                            มา
                          </button>
                          <button
                            onClick={() => setStudentAttendance(student.id, 'late')}
                            disabled={currentUser.role !== 'teacher'}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${status === 'late' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'} disabled:opacity-60`}
                          >
                            สาย
                          </button>
                          <button
                            onClick={() => setStudentAttendance(student.id, 'absent')}
                            disabled={currentUser.role !== 'teacher'}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${status === 'absent' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'} disabled:opacity-60`}
                          >
                            ขาด
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {currentUser.role === 'teacher' && (
              <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-slate-200/50 p-6 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h4 className="text-xl font-bold text-slate-900">รายงานเช็คชื่อย้อนหลังรายเดือน</h4>
                    <p className="text-sm text-slate-500 mt-1">ดูสถิติ มา/สาย/ขาด แยกรายนักเรียนรายเดือน</p>
                  </div>
                  <button
                    onClick={() => setShowMonthlyReport(v => !v)}
                    className="px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 transition-all self-start md:self-auto"
                  >
                    {showMonthlyReport ? 'ซ่อนรายงาน' : 'ดูรายงาน'}
                  </button>
                </div>

                {showMonthlyReport && (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                        <Search className="w-4 h-4 text-slate-400" />
                        <input
                          value={monthlyReportSearch}
                          onChange={(e) => setMonthlyReportSearch(e.target.value)}
                          className="w-56 bg-transparent outline-none text-sm text-slate-700"
                          placeholder="ค้นหารายงานด้วยชื่อ/รหัส"
                        />
                      </div>
                      <select
                        value={monthlyRateSort}
                        onChange={(e) => setMonthlyRateSort(e.target.value as 'desc' | 'asc')}
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700"
                      >
                        <option value="desc">% เข้าเรียน มากไปน้อย</option>
                        <option value="asc">% เข้าเรียน น้อยไปมาก</option>
                      </select>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white">
                        <span className="text-xs text-slate-500 whitespace-nowrap">เกณฑ์เตือน &lt;</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={attendanceWarningThreshold}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (Number.isNaN(next)) return;
                            setAttendanceWarningThreshold(Math.max(0, Math.min(100, next)));
                          }}
                          className="w-16 bg-transparent outline-none text-sm text-slate-700"
                        />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                      <input
                        type="month"
                        value={reportMonth}
                        onChange={(e) => setReportMonth(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
                      />
                    </div>

                    {isMonthlyReportLoading ? (
                      <p className="text-sm text-slate-500">กำลังโหลดรายงานรายเดือน...</p>
                    ) : monthlyReportRows.length === 0 ? (
                      <p className="text-sm text-slate-500">ยังไม่มีข้อมูลรายงานสำหรับเดือนนี้</p>
                    ) : filteredMonthlyReportRows.length === 0 ? (
                      <p className="text-sm text-slate-500">ไม่พบข้อมูลนักเรียนที่ตรงกับคำค้นหา</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[820px] text-sm">
                          <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200">
                              <th className="py-2 pr-3">รหัส</th>
                              <th className="py-2 pr-3">ชื่อ-สกุล</th>
                              <th className="py-2 pr-3">มา</th>
                              <th className="py-2 pr-3">สาย</th>
                              <th className="py-2 pr-3">ขาด</th>
                              <th className="py-2 pr-3">บันทึกแล้ว</th>
                              <th className="py-2 pr-3">% เข้าเรียน</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedMonthlyReportRows.map((row) => {
                              const rate = getAttendanceRatePercent(row);
                              const isWarning = row.checked_count > 0 && rate < attendanceWarningThreshold;

                              return (
                              <tr key={row.student_id} className={`border-b border-slate-100 text-slate-700 ${isWarning ? 'bg-rose-50/60' : ''}`}>
                                <td className="py-2 pr-3">{row.student_code || '-'}</td>
                                <td className="py-2 pr-3">{row.student_name}</td>
                                <td className="py-2 pr-3 text-emerald-700 font-semibold">{row.present_count}</td>
                                <td className="py-2 pr-3 text-amber-700 font-semibold">{row.late_count}</td>
                                <td className="py-2 pr-3 text-rose-700 font-semibold">{row.absent_count}</td>
                                <td className="py-2 pr-3">{row.checked_count}</td>
                                <td className={`py-2 pr-3 font-semibold ${isWarning ? 'text-rose-700' : 'text-pink-600'}`}>
                                  {rate.toFixed(1)}%
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'attendance' && currentUser.role !== 'teacher' && (
          <div className="lg:col-span-3">
            <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-slate-200/50 p-8 shadow-sm">
              <h3 className="text-2xl font-bold text-slate-900">การเข้าเรียนของคุณ</h3>
              <p className="text-sm text-slate-500 mt-1 mb-6">สถานะการเข้าเรียนประจำวัน</p>
              <div className="flex items-center gap-3 mb-8">
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
                />
              </div>
              {isAttendanceLoading ? (
                <p className="text-sm text-slate-500">กำลังโหลดข้อมูล...</p>
              ) : attendanceByStudent[currentUser.id] === 'present' ? (
                <div className="flex items-center gap-4 p-6 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">✅</div>
                  <div>
                    <p className="text-xl font-bold text-emerald-700">มาเรียน</p>
                    <p className="text-sm text-emerald-600">คุณมาเรียนในวันนี้</p>
                  </div>
                </div>
              ) : attendanceByStudent[currentUser.id] === 'late' ? (
                <div className="flex items-center gap-4 p-6 bg-amber-50 border border-amber-200 rounded-2xl">
                  <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-3xl">🕐</div>
                  <div>
                    <p className="text-xl font-bold text-amber-700">มาสาย</p>
                    <p className="text-sm text-amber-600">คุณมาเรียนสายในวันนี้</p>
                  </div>
                </div>
              ) : attendanceByStudent[currentUser.id] === 'absent' ? (
                <div className="flex items-center gap-4 p-6 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center text-3xl">❌</div>
                  <div>
                    <p className="text-xl font-bold text-rose-700">ขาด</p>
                    <p className="text-sm text-rose-600">คุณขาดเรียนในวันนี้</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 p-6 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-2xl text-slate-400 font-light">–</div>
                  <div>
                    <p className="text-xl font-bold text-slate-700">ยังไม่เช็ค</p>
                    <p className="text-sm text-slate-500">ครูยังไม่ได้เช็คชื่อในวันนี้</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'people' && (
          <div className="lg:col-span-3 bg-white/40 backdrop-blur-md rounded-3xl border border-slate-200/50 overflow-hidden shadow-sm">
            <div className="p-8 border-b border-slate-200/50">
              <h3 className="text-2xl font-bold text-pink-600 mb-6">ครู</h3>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-pink-500/10 flex items-center justify-center overflow-hidden">
                  {classTeacher?.profile_picture ? (
                    <img src={classTeacher.profile_picture} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <UserIcon className="w-6 h-6 text-pink-500" />
                  )}
                </div>
                <div>
                  <p className="font-bold text-slate-900">{classTeacher?.name || 'ครูประจำวิชา'}</p>
                  <p className="text-sm text-slate-500">{classTeacher?.bio}</p>
                </div>
              </div>
            </div>
            <div className="p-8">
              {currentUser.role === 'teacher' ? (
                <>
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-2xl font-bold text-pink-600">นักเรียน</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-400">{filteredStudents.length}/{classStudents.length} คน</span>
                      <button
                        onClick={downloadStudentExcelTemplate}
                        className="flex items-center gap-2 bg-slate-700 text-white px-3.5 py-2 rounded-xl text-sm font-semibold hover:bg-slate-600 transition-all"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        ดาวน์โหลดเทมเพลต Excel
                      </button>
                      <input
                        ref={excelInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={importStudentsFromExcel}
                        className="hidden"
                      />
                      <button
                        onClick={() => excelInputRef.current?.click()}
                        disabled={isImportingStudents}
                        className="flex items-center gap-2 bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-sm font-semibold hover:bg-emerald-500 transition-all disabled:opacity-60"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        {isImportingStudents ? 'กำลังนำเข้า...' : 'เพิ่มรายชื่อเป็นไฟล์ Excel'}
                      </button>
                      <button
                        onClick={() => setIsAddStudentOpen(true)}
                        className="flex items-center gap-2 bg-pink-600 text-white px-3.5 py-2 rounded-xl text-sm font-semibold hover:bg-pink-500 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        เพิ่มนักเรียนเข้าชั้น
                      </button>
                    </div>
                  </div>
                  <div className="mb-5">
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                      <Search className="w-4 h-4 text-slate-400" />
                      <input
                        value={studentSearchInput}
                        onChange={(e) => setStudentSearchInput(e.target.value)}
                        onKeyDown={handleStudentSearchKeyDown}
                        className="w-full bg-transparent outline-none text-sm text-slate-700"
                        placeholder="ค้นหานักเรียนด้วยชื่อ รหัสนักศึกษา หรืออีเมล"
                      />
                    </div>
                  </div>
                  <div className="space-y-6">
                    {filteredStudents.map((student, index) => (
                      <div
                        key={student.id}
                        ref={index === 0 ? firstFilteredStudentRef : null}
                        tabIndex={-1}
                        className="flex items-center gap-4 pb-4 border-b border-slate-100 last:border-0 outline-none focus:ring-2 focus:ring-pink-200 rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center overflow-hidden">
                          {student.profile_picture ? (
                            <img src={student.profile_picture} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <UserIcon className="w-5 h-5 text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingStudentId === student.id ? (
                            <div className="space-y-2">
                              <input
                                value={studentForm.name}
                                onChange={(e) => setStudentForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm"
                                placeholder="ชื่อนักเรียน"
                              />
                              <input
                                value={studentForm.student_id}
                                onChange={(e) => setStudentForm(prev => ({ ...prev, student_id: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm"
                                placeholder="รหัสนักศึกษา"
                              />
                              <input
                                value={studentForm.bio}
                                onChange={(e) => setStudentForm(prev => ({ ...prev, bio: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm"
                                placeholder="ข้อมูลเพิ่มเติม"
                              />
                            </div>
                          ) : (
                            <>
                              <p className="font-medium text-slate-600">{student.name}</p>
                              <p className="text-xs text-slate-400">{student.student_id || 'ไม่มีรหัสนักศึกษา'}</p>
                              <p className="text-xs text-slate-400">{student.bio}</p>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {editingStudentId === student.id ? (
                            <>
                              <button
                                onClick={saveStudent}
                                disabled={isSavingStudent}
                                className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-60"
                                title="บันทึก"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelEditStudent}
                                disabled={isSavingStudent}
                                className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                                title="ยกเลิก"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEditStudent(student)}
                                className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100"
                                title="แก้ไข"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeStudentFromClass(student)}
                                className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                                title="ลบออกจากชั้นเรียน"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {classStudents.length === 0 && (
                      <div className="py-10 text-center text-slate-400">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-25" />
                        <p className="text-sm">ยังไม่มีนักเรียนในชั้นเรียนนี้</p>
                      </div>
                    )}
                    {classStudents.length > 0 && filteredStudents.length === 0 && (
                      <div className="py-10 text-center text-slate-400">
                        <Search className="w-8 h-8 mx-auto mb-2 opacity-25" />
                        <p className="text-sm">ไม่พบนักเรียนที่ตรงกับคำค้นหา</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center">
                  <p className="text-sm font-semibold text-slate-700">ซ่อนรายชื่อนักเรียนเพื่อความเป็นส่วนตัว</p>
                  <p className="mt-1 text-xs text-slate-500">นักเรียนจะไม่เห็นรายชื่อเพื่อนในชั้นเรียน</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {undoStudent && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="fixed bottom-6 right-6 z-[230] bg-white border border-amber-200 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 relative overflow-hidden"
        >
          <span className="text-sm text-slate-700">ลบ {undoStudent.name} แล้ว ({undoSecondsLeft}s)</span>
          <button
            onClick={restoreStudentToClass}
            className="text-sm font-bold text-amber-600 hover:text-amber-500"
          >
            Undo
          </button>
          <button
            onClick={clearUndoState}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            title="ปิด"
          >
            <X className="w-4 h-4" />
          </button>
          <div
            className="absolute left-0 bottom-0 h-1 bg-amber-300 transition-all duration-1000 ease-linear"
            style={{ width: `${undoProgressPercent}%` }}
          />
        </motion.div>
      )}

      <div className="fixed bottom-6 left-6 z-[220] space-y-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-center gap-2 ${
                toast.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {toast.type === 'success' ? <CircleCheck className="w-4 h-4" /> : <CircleX className="w-4 h-4" />}
              <span>{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {isAddStudentOpen && (
        <Modal title="เพิ่มนักเรียนเข้าชั้น" onClose={() => setIsAddStudentOpen(false)}>
          <form onSubmit={addStudentToClass} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">รหัสนักศึกษา</label>
              <input
                value={addStudentForm.student_id}
                onChange={(e) => setAddStudentForm(prev => ({ ...prev, student_id: e.target.value }))}
                required
                inputMode="numeric"
                pattern="\d{11}"
                maxLength={11}
                minLength={11}
                title="กรอกรหัสนักศึกษาเป็นตัวเลข 11 หลัก"
                className="w-full px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-pink-500 outline-none"
                placeholder="เช่น 68219100001"
              />
              <p className="mt-1 text-xs text-slate-400">กรอกเป็นตัวเลข 11 หลักเท่านั้น</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">ชื่อ-สกุล</label>
              <input
                value={addStudentForm.full_name}
                onChange={(e) => setAddStudentForm(prev => ({ ...prev, full_name: e.target.value }))}
                required
                className="w-full px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-pink-500 outline-none"
                placeholder="เช่น นายตัวอย่าง ใจดี"
              />
            </div>
            <button
              type="submit"
              disabled={isAddingStudent}
              className="w-full bg-pink-600 text-white py-2.5 rounded-xl font-semibold hover:bg-pink-500 transition-all disabled:opacity-60"
            >
              {isAddingStudent ? 'กำลังเพิ่ม...' : 'เพิ่มนักเรียน'}
            </button>
          </form>
        </Modal>
      )}
    </motion.div>
  );
};

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative my-3 sm:my-0 bg-white/90 backdrop-blur-xl border border-white rounded-3xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-5 sm:p-8"
      >
        <h3 className="text-2xl font-bold mb-6 text-slate-900">{title}</h3>
        {children}
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 text-slate-400 hover:text-pink-600 transition-colors"
        >
          <LogOut className="w-5 h-5 rotate-180" />
        </button>
      </motion.div>
    </div>
  );
}
