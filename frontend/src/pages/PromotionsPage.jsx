import { useEffect, useState } from 'react';
import apiClient from '../api/client';

export const PromotionsPage = () => {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchPromotions = async () => {
    try {
      const response = await apiClient.get('/promotions');
      setPromotions(response.data.results || []);
    } catch (err) {
      setError('Failed to load promotions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isActive = (promo) => {
    const now = new Date();
    const start = new Date(promo.startTime);
    const end = new Date(promo.endTime);
    return start <= now && end >= now;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading promotions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 text-red-600 p-4 rounded">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Available Promotions</h1>

      {promotions.length === 0 ? (
        <div className="bg-gray-50 p-8 rounded-lg text-center text-gray-600">
          No promotions available at this time
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {promotions.map((promo) => (
            <div
              key={promo.id}
              className={`bg-white rounded-lg shadow-lg p-6 border-2 ${
                isActive(promo) ? 'border-green-400' : 'border-gray-200'
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-xl font-bold">{promo.name}</h3>
                {isActive(promo) && (
                  <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                    Active
                  </span>
                )}
              </div>

              <p className="text-gray-600 mb-4">{promo.description}</p>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Type:</span>
                  <span className="font-semibold capitalize">{promo.type}</span>
                </div>

                {promo.minSpending && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Min Spending:</span>
                    <span className="font-semibold">${promo.minSpending}</span>
                  </div>
                )}

                {promo.rate && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Rate:</span>
                    <span className="font-semibold">{promo.rate}x</span>
                  </div>
                )}

                {promo.points && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Points:</span>
                    <span className="font-semibold">{promo.points}</span>
                  </div>
                )}

                <div className="pt-3 border-t mt-3">
                  <p className="text-xs text-gray-500">
                    Valid: {new Date(promo.startTime).toLocaleDateString()} -{' '}
                    {new Date(promo.endTime).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
