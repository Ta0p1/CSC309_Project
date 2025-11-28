import { useAuth } from '../contexts/AuthContext';
import { QRCodeSVG } from 'qrcode.react';

export const QRCodePage = () => {
  const { user } = useAuth();

  if (!user) {
    return <div>Loading...</div>;
  }

  // QR code contains the user ID for transaction purposes
  const qrValue = user.utorid;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">My QR Code</h1>

      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          <p className="text-gray-600 mb-6">
            Show this QR code to initiate a transaction
          </p>

          <div className="flex justify-center mb-6">
            <div className="bg-white p-6 rounded-lg border-4 border-gray-200">
              <QRCodeSVG
                value={qrValue}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg inline-block">
            <p className="text-sm text-gray-600">UTORid</p>
            <p className="text-2xl font-bold">{user.utorid}</p>
          </div>

          <div className="mt-6 text-sm text-gray-500">
            <p>This QR code can be scanned by cashiers to:</p>
            <ul className="mt-2 space-y-1">
              <li>Process purchases</li>
              <li>Transfer points</li>
              <li>Award event points</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
