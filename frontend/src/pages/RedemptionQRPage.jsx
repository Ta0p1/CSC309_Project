import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import apiClient from '../api/client';
import { Button } from '../components/ui/button';

export const RedemptionQRPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState(location.state?.transaction);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!transaction) {
      // If no transaction in state, try to fetch pending redemption
      fetchPendingRedemption();
    }
  }, []);

  const fetchPendingRedemption = async () => {
    try {
      const response = await apiClient.get('/users/me/transactions');
      const pending = response.data.results?.find(
        t => t.type === 'redemption' && !t.processedById
      );
      if (pending) {
        setTransaction(pending);
      } else {
        navigate('/redemption');
      }
    } catch (err) {
      console.error('Failed to fetch pending redemption:', err);
      navigate('/redemption');
    }
  };

  const checkStatus = async () => {
    if (!transaction) return;

    setChecking(true);
    try {
      const response = await apiClient.get('/users/me/transactions');
      const updated = response.data.results?.find(t => t.id === transaction.id);

      if (updated?.processedById) {
        alert('Redemption processed successfully!');
        navigate('/transactions');
      } else {
        alert('Redemption not yet processed');
      }
    } catch (err) {
      console.error('Failed to check status:', err);
    } finally {
      setChecking(false);
    }
  };

  if (!transaction) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // QR code contains the transaction ID
  const qrValue = transaction.id.toString();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Redemption QR Code</h1>

      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          <div className="mb-6 bg-yellow-50 p-4 rounded">
            <p className="text-sm text-gray-600">Redemption Amount</p>
            <p className="text-3xl font-bold text-yellow-600">
              {Math.abs(transaction.amount)} points
            </p>
          </div>

          <p className="text-gray-600 mb-6">
            Show this QR code to a cashier to process your redemption
          </p>

          <div className="flex justify-center mb-6">
            <div className="bg-white p-6 rounded-lg border-4 border-yellow-300">
              <QRCodeSVG
                value={qrValue}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg inline-block mb-6">
            <p className="text-sm text-gray-600">Transaction ID</p>
            <p className="text-2xl font-bold">{transaction.id}</p>
          </div>

          {transaction.remark && (
            <div className="bg-gray-50 p-4 rounded mb-6">
              <p className="text-sm text-gray-600">Remark</p>
              <p className="text-gray-800">{transaction.remark}</p>
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={checkStatus}
              disabled={checking}
              className="w-full"
            >
              {checking ? 'Checking...' : 'Check Status'}
            </Button>

            <Button
              onClick={() => navigate('/redemption')}
              variant="outline"
              className="w-full"
            >
              Back to Redemption
            </Button>
          </div>

          <div className="mt-6 text-sm text-gray-500">
            <p>This redemption request is pending.</p>
            <p>A cashier must scan this QR code to complete the redemption.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
