import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { Button } from '../components/ui/button';

export const RedemptionPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingRedemption, setPendingRedemption] = useState(null);

  useEffect(() => {
    checkPendingRedemption();
  }, []);

  const checkPendingRedemption = async () => {
    try {
      // Get user's transactions and find unprocessed redemption
      const response = await apiClient.get('/users/me/transactions');
      const unprocessed = response.data.results?.find(
        t => t.type === 'redemption' && !t.processedById
      );
      setPendingRedemption(unprocessed);
    } catch (err) {
      console.error('Failed to check pending redemptions:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.post('/users/me/transactions', {
        type: 'redemption',
        amount: parseInt(amount),
        remark
      });

      // Navigate to the redemption QR code page
      navigate('/redemption-qr', { state: { transaction: response.data } });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create redemption request');
    } finally {
      setLoading(false);
    }
  };

  if (pendingRedemption) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Redemption Request</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Pending Redemption</h2>
          <p className="mb-4">
            You already have a pending redemption request for {Math.abs(pendingRedemption.amount)} points.
          </p>
          <Button onClick={() => navigate('/redemption-qr', { state: { transaction: pendingRedemption } })}>
            View QR Code
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Request Point Redemption</h1>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="mb-6 bg-blue-50 p-4 rounded">
          <p className="text-sm text-gray-600">Your Available Points</p>
          <p className="text-2xl font-bold text-blue-600">{user?.points || 0}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-2">
              Points to Redeem
            </label>
            <input
              id="amount"
              type="number"
              required
              min="1"
              max={user?.points || 0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter points to redeem"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Maximum: {user?.points || 0} points
            </p>
          </div>

          <div>
            <label htmlFor="remark" className="block text-sm font-medium text-gray-700 mb-2">
              Remark (optional)
            </label>
            <textarea
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Add a note about your redemption"
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded">{error}</div>
          )}

          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600">
              After submitting this request, you will receive a QR code that a cashier must scan to process your redemption.
            </p>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Creating Request...' : 'Create Redemption Request'}
          </Button>
        </form>
      </div>
    </div>
  );
};
