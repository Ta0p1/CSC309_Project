import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';

export const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null;

  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex space-x-8">
            <Link to="/" className="flex items-center text-lg font-bold text-gray-900">
              Loyalty Program
            </Link>
            <div className="flex items-center space-x-4">
              <Link to="/points" className="text-gray-700 hover:text-gray-900">
                Points
              </Link>
              <Link to="/qr-code" className="text-gray-700 hover:text-gray-900">
                My QR Code
              </Link>
              <Link to="/transfer" className="text-gray-700 hover:text-gray-900">
                Transfer
              </Link>
              <Link to="/redemption" className="text-gray-700 hover:text-gray-900">
                Redeem
              </Link>
              <Link to="/promotions" className="text-gray-700 hover:text-gray-900">
                Promotions
              </Link>
              <Link to="/events" className="text-gray-700 hover:text-gray-900">
                Events
              </Link>
              <Link to="/transactions" className="text-gray-700 hover:text-gray-900">
                Transactions
              </Link>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-gray-700">{user.name}</span>
            <span className="text-sm text-gray-500">({user.role})</span>
            <Button onClick={handleLogout} variant="outline">
              Logout
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
};
