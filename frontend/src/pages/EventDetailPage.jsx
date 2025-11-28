import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/client';
import { Button } from '../components/ui/button';

export const EventDetailPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [isRsvped, setIsRsvped] = useState(false);

  useEffect(() => {
    fetchEvent();
  }, [id]);

  const fetchEvent = async () => {
    try {
      const response = await apiClient.get(`/events/${id}`);
      setEvent(response.data);

      // Check if user is already RSVPed
      if (response.data.guests) {
        setIsRsvped(response.data.guests.some(g => g.userId === user.id));
      }
    } catch (err) {
      setError('Failed to load event details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRSVP = async () => {
    setActionLoading(true);
    setError('');

    try {
      await apiClient.post(`/events/${id}/guests/me`);
      setIsRsvped(true);
      await fetchEvent(); // Refresh event data
      alert('Successfully RSVPed to the event!');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to RSVP');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRSVP = async () => {
    setActionLoading(true);
    setError('');

    try {
      await apiClient.delete(`/events/${id}/guests/me`);
      setIsRsvped(false);
      await fetchEvent(); // Refresh event data
      alert('Successfully cancelled RSVP');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel RSVP');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading event details...</div>
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 text-red-600 p-4 rounded">{error}</div>
        <Button onClick={() => navigate('/events')} className="mt-4">
          Back to Events
        </Button>
      </div>
    );
  }

  const isUpcoming = new Date(event.startTime) > new Date();
  const isOngoing = new Date(event.startTime) <= new Date() && new Date(event.endTime) >= new Date();
  const hasEnded = new Date(event.endTime) < new Date();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Button onClick={() => navigate('/events')} variant="outline" className="mb-6">
        ← Back to Events
      </Button>

      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="flex justify-between items-start mb-6">
          <h1 className="text-4xl font-bold">{event.name}</h1>
          <span className={`px-4 py-2 rounded text-sm font-semibold ${
            isOngoing ? 'bg-green-100 text-green-800' :
            isUpcoming ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {isOngoing ? 'Ongoing' : isUpcoming ? 'Upcoming' : 'Ended'}
          </span>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Description</h2>
          <p className="text-gray-700">{event.description}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600 mb-1">📍 Location</p>
            <p className="font-semibold">{event.location}</p>
          </div>

          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600 mb-1">👥 Capacity</p>
            <p className="font-semibold">
              {event.capacity ? `${event.capacity} people` : 'Unlimited'}
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600 mb-1">🕐 Start Time</p>
            <p className="font-semibold">{new Date(event.startTime).toLocaleString()}</p>
          </div>

          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600 mb-1">🕐 End Time</p>
            <p className="font-semibold">{new Date(event.endTime).toLocaleString()}</p>
          </div>
        </div>

        <div className="bg-blue-50 p-6 rounded-lg mb-6">
          <h3 className="text-lg font-semibold mb-2">Event Points</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Total Points</p>
              <p className="text-2xl font-bold text-blue-600">{event.pointsTotal}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Remaining</p>
              <p className="text-2xl font-bold text-blue-600">{event.pointsRemain}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Awarded</p>
              <p className="text-2xl font-bold text-blue-600">{event.pointsAwarded}</p>
            </div>
          </div>
        </div>

        {event.guests && event.guests.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">RSVPed Guests ({event.guests.length})</h3>
            <div className="bg-gray-50 p-4 rounded max-h-40 overflow-y-auto">
              <div className="text-sm text-gray-600">
                {event.guests.length} {event.guests.length === 1 ? 'person has' : 'people have'} RSVPed
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
        )}

        {!hasEnded && (
          <div className="flex gap-4">
            {!isRsvped ? (
              <Button
                onClick={handleRSVP}
                disabled={actionLoading}
                className="flex-1"
              >
                {actionLoading ? 'Processing...' : 'RSVP to Event'}
              </Button>
            ) : (
              <Button
                onClick={handleCancelRSVP}
                disabled={actionLoading}
                variant="outline"
                className="flex-1"
              >
                {actionLoading ? 'Processing...' : 'Cancel RSVP'}
              </Button>
            )}
          </div>
        )}

        {hasEnded && (
          <div className="bg-gray-100 p-4 rounded text-center text-gray-600">
            This event has ended
          </div>
        )}
      </div>
    </div>
  );
};
