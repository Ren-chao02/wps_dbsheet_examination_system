import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { StudentLayout } from './components/layout/StudentLayout';
import { TeacherLayout } from './components/layout/TeacherLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { StudentDashboard } from './pages/student/Dashboard';
import { ExamIntroPage } from './pages/student/ExamIntro';
import { ExamDoingPage } from './pages/student/ExamDoing';
import { ExamResultPage } from './pages/student/ExamResult';
import { TeacherDashboard } from './pages/teacher/Dashboard';
import { QuestionBank } from './pages/teacher/QuestionBank';
import { QuestionEditor } from './pages/teacher/QuestionEditor';
import { ExamManager } from './pages/teacher/ExamManager';
import { ExamForm } from './pages/teacher/ExamForm';
import { ExamMonitor } from './pages/teacher/ExamMonitor';
import { GradingPage } from './pages/teacher/GradingPage';
import { StatisticsPage } from './pages/teacher/StatisticsPage';
import { StudentProfilePage } from './pages/teacher/StudentProfile';
import { UserManagement } from './pages/admin/UserManagement';
import { DemoPage } from './pages/demo/DemoPage';

function PrivateRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Student */}
      <Route path="/student" element={
        <PrivateRoute roles={['student']}><StudentLayout /></PrivateRoute>
      }>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<StudentDashboard />} />
        <Route path="exam/:id" element={<ExamIntroPage />} />
        <Route path="exam/:id/doing" element={<ExamDoingPage />} />
        <Route path="exam/:id/result" element={<ExamResultPage />} />
      </Route>

      {/* Teacher */}
      <Route path="/teacher" element={
        <PrivateRoute roles={['teacher', 'admin']}><TeacherLayout /></PrivateRoute>
      }>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<TeacherDashboard />} />
        <Route path="questions" element={<QuestionBank />} />
        <Route path="questions/new" element={<QuestionEditor />} />
        <Route path="questions/:id/edit" element={<QuestionEditor />} />
        <Route path="exams" element={<ExamManager />} />
        <Route path="exams/new" element={<ExamForm />} />
        <Route path="exams/:id/edit" element={<ExamForm />} />
        <Route path="exams/:id/monitor" element={<ExamMonitor />} />
        <Route path="exams/:id/grading" element={<GradingPage />} />
        <Route path="exams/:id/statistics" element={<StatisticsPage />} />
        <Route path="students/:id/profile" element={<StudentProfilePage />} />
      </Route>

      {/* Admin */}
      <Route path="/admin" element={
        <PrivateRoute roles={['admin']}><AdminLayout /></PrivateRoute>
      }>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UserManagement />} />
      </Route>

      {/* Demo - 金山多维表格 API 测试 */}
      <Route path="/demo" element={<DemoPage />} />

      {/* Default */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
