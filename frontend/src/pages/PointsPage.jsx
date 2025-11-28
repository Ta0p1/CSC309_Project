import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/client';

export const PointsPage = () => {
  const { user } = useAuth();
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const response = await apiClient.get('/users/me');
      setUserData(response.data);
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">My Points</h1>

      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <p className="text-gray-600 text-lg mb-2">Available Points</p>
        <p className="text-6xl font-bold text-blue-600">{userData?.points || 0}</p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600">Name</p>
            <p className="font-semibold">{userData?.name}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600">UTORid</p>
            <p className="font-semibold">{userData?.utorid}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600">Status</p>
            <p className="font-semibold">
              {userData?.verified ? (
                <span className="text-green-600">Verified</span>
              ) : (
                <span className="text-yellow-600">Unverified</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
