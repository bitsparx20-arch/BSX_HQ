import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AttendanceProvider } from "@/contexts/AttendanceContext";
import { SidebarAlertsProvider } from "@/contexts/SidebarAlertsContext";
import { NotesDraftProvider } from "@/contexts/NotesDraftContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Layout from "@/components/Layout";
import SessionGuard from "@/components/SessionGuard";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Attendance from "@/pages/Attendance";
import Projects from "@/pages/Projects";
import Finance from "@/pages/Finance";
import Employees from "@/pages/Employees";
import Meetings from "@/pages/Meetings";
import ClientVisits from "@/pages/ClientVisits";
import Assets from "@/pages/Assets";
import AMC from "@/pages/AMC";
import Helpdesk from "@/pages/Helpdesk";
import Documents from "@/pages/Documents";
import Reports from "@/pages/Reports";
import CRM from "@/pages/CRM";
import Notifications from "@/pages/Notifications";
import AssignedTasks from "@/pages/AssignedTasks";
import Notes from "@/pages/Notes";

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bx-bg-2)]">
        <div className="text-[var(--bx-text-3)] bx-mono text-sm">Loading Bitsparx HQ…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bx-bg-2)]">
        <div className="text-[var(--bx-text-3)] bx-mono text-sm">Loading Bitsparx HQ…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return children;
};

const ManagerAdminRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bx-bg-2)]">
        <div className="text-[var(--bx-text-3)] bx-mono text-sm">Loading Bitsparx HQ…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <div className="App">
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Toaster position="bottom-right" richColors duration={3000} />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <SessionGuard>
                      <AttendanceProvider>
                        <SidebarAlertsProvider>
                          <NotesDraftProvider>
                            <Layout />
                          </NotesDraftProvider>
                        </SidebarAlertsProvider>
                      </AttendanceProvider>
                    </SessionGuard>
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="attendance" element={<Attendance />} />
                <Route path="assigned-tasks" element={<AssignedTasks />} />
                <Route path="notes" element={<Notes />} />
                <Route path="projects" element={<Projects />} />
                <Route path="finance" element={<Finance />} />
                <Route path="employees" element={<Employees />} />
                <Route path="meetings" element={<Meetings />} />
                <Route path="visits" element={<ClientVisits />} />
                <Route path="assets" element={<Assets />} />
                <Route path="amc" element={<AMC />} />
                <Route path="helpdesk" element={<Helpdesk />} />
                <Route path="documents" element={<ManagerAdminRoute><Documents /></ManagerAdminRoute>} />
                <Route path="reports" element={<Reports />} />
                <Route path="crm" element={<AdminRoute><CRM /></AdminRoute>} />
                <Route path="notifications" element={<Notifications />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </div>
  );
}

export default App;
