import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { LoginPage } from './pages/LoginPage';
import { PointsPage } from './pages/PointsPage';
import { QRCodePage } from './pages/QRCodePage';
import { TransferPage } from './pages/TransferPage';
import { RedemptionPage } from './pages/RedemptionPage';
import { RedemptionQRPage } from './pages/RedemptionQRPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { EventsPage } from './pages/EventsPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { TransactionsPage } from './pages/TransactionsPage';
import './App.css';

// Protected route wrapper
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50">
        {children}
      </div>
    </>
  );
};

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <PointsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/points"
        element={
          <ProtectedRoute>
            <PointsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/qr-code"
        element={
          <ProtectedRoute>
            <QRCodePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/transfer"
        element={
          <ProtectedRoute>
            <TransferPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/redemption"
        element={
          <ProtectedRoute>
            <RedemptionPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/redemption-qr"
        element={
          <ProtectedRoute>
            <RedemptionQRPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/promotions"
        element={
          <ProtectedRoute>
            <PromotionsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/events"
        element={
          <ProtectedRoute>
            <EventsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/events/:id"
        element={
          <ProtectedRoute>
            <EventDetailPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/transactions"
        element={
          <ProtectedRoute>
            <TransactionsPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
