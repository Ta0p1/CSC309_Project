import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/client';
import { Button } from '../components/ui/button';

export const TransferPage = () => {
  const { user } = useAuth();
  const [recipientUtorid, setRecipientUtorid] = useState('');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await apiClient.post('/users/me/transactions', {
        type: 'transfer',
        recipientUtorid,
        amount: parseInt(amount),
        remark
      });

      setSuccess(`Successfully transferred ${amount} points to ${recipientUtorid}`);
      setRecipientUtorid('');
      setAmount('');
      setRemark('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to transfer points');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Transfer Points</h1>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="mb-6 bg-blue-50 p-4 rounded">
          <p className="text-sm text-gray-600">Your Available Points</p>
          <p className="text-2xl font-bold text-blue-600">{user?.points || 0}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="recipient" className="block text-sm font-medium text-gray-700 mb-2">
              Recipient UTORid
            </label>
            <input
              id="recipient"
              type="text"
              required
              value={recipientUtorid}
              onChange={(e) => setRecipientUtorid(e.target.value)}
              placeholder="Enter recipient's UTORid"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-2">
              Amount
            </label>
            <input
              id="amount"
              type="number"
              required
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount to transfer"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="remark" className="block text-sm font-medium text-gray-700 mb-2">
              Remark (optional)
            </label>
            <textarea
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Add a note"
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded">{error}</div>
          )}

          {success && (
            <div className="bg-green-50 text-green-600 p-3 rounded">{success}</div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Processing...' : 'Transfer Points'}
          </Button>
        </form>
      </div>
    </div>
  );
};
