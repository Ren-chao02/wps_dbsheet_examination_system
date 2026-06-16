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
import StudentManagement from './pages/teacher/StudentManagement';
import StudentImport from './pages/teacher/StudentImport';
import ImportTaskList from './pages/teacher/ImportTaskList';
import DepartmentManagement from './pages/teacher/DepartmentManagement';
import { DemoPage } from './pages/demo/DemoPage';
import InvitationManagement from './pages/teacher/InvitationManagement';
import ApplicationReview from './pages/teacher/ApplicationReview';
import StudentJoinPage from './pages/public/StudentJoinPage';
import ForbiddenPage from './pages/public/ForbiddenPage';
import RoleManagement from './pages/admin/RoleManagement';
import AccountManagement from './pages/admin/AccountManagement';
import AccountImport from './pages/admin/AccountImport';
import SystemImportTaskList from './pages/admin/SystemImportTaskList';
import CacheManagement from './pages/admin/CacheManagement';

function PrivateRoute({ children, roles, permissions }: { children: React.ReactNode; roles?: string[]; permissions?: string[] }) {
  const { isAuthenticated, isLoading, user, hasPermission } = useAuthStore();

  if (isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>加载中...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }

  if (permissions && permissions.length > 0) {
    const allowed = permissions.some((p) => hasPermission(p));
    if (!allowed) {
      return <Navigate to="/forbidden" replace />;
    }
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
        <Route path="departments" element={<DepartmentManagement />} />
        <Route path="students" element={<StudentManagement />} />
        <Route path="students/import" element={<StudentImport />} />
        <Route path="invitations" element={<InvitationManagement />} />
        <Route path="applications" element={<ApplicationReview />} />
        <Route path="import-tasks" element={<ImportTaskList />} />
      </Route>

      {/* Public - Student Join */}
      <Route path="/join/:code" element={<StudentJoinPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />

      {/* Admin */}
      <Route path="/admin" element={
        <PrivateRoute roles={['admin']}><AdminLayout /></PrivateRoute>
      }>
        <Route index element={<Navigate to="accounts" replace />} />
        <Route path="users" element={<Navigate to="/admin/accounts" replace />} />
        <Route path="accounts" element={<AccountManagement />} />
        <Route path="accounts/import" element={<AccountImport />} />
        <Route path="roles" element={<RoleManagement />} />
        <Route path="import-tasks" element={<SystemImportTaskList />} />
        <Route path="cache" element={<CacheManagement />} />
      </Route>

      {/* Demo - 金山多维表格 API 测试 */}
      <Route path="/demo" element={<DemoPage />} />

      {/* Default */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
