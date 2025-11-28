import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { Button } from '../components/ui/button';

export const EventsPage = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      // Get only published events for regular users
      const response = await apiClient.get('/events?published=true');
      setEvents(response.data.results || []);
    } catch (err) {
      setError('Failed to load events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isUpcoming = (event) => {
    return new Date(event.startTime) > new Date();
  };

  const isOngoing = (event) => {
    const now = new Date();
    return new Date(event.startTime) <= now && new Date(event.endTime) >= now;
  };

  const getEventStatus = (event) => {
    if (isOngoing(event)) return { text: 'Ongoing', color: 'bg-green-100 text-green-800' };
    if (isUpcoming(event)) return { text: 'Upcoming', color: 'bg-blue-100 text-blue-800' };
    return { text: 'Ended', color: 'bg-gray-100 text-gray-800' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading events...</div>
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
      <h1 className="text-3xl font-bold mb-6">Published Events</h1>

      {events.length === 0 ? (
        <div className="bg-gray-50 p-8 rounded-lg text-center text-gray-600">
          No events available at this time
        </div>
      ) : (
        <div className="space-y-6">
          {events.map((event) => {
            const status = getEventStatus(event);
            return (
              <div
                key={event.id}
                className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-2xl font-bold">{event.name}</h3>
                      <span className={`text-xs px-3 py-1 rounded ${status.color}`}>
                        {status.text}
                      </span>
                    </div>
                    <p className="text-gray-600 mb-2">{event.description}</p>
                    <p className="text-sm text-gray-500 flex items-center gap-2">
                      <span>📍</span>
                      {event.location}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">Start Time</p>
                    <p className="font-semibold">
                      {new Date(event.startTime).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">End Time</p>
                    <p className="font-semibold">
                      {new Date(event.endTime).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">Capacity</p>
                    <p className="font-semibold">
                      {event.capacity ? `${event.capacity} people` : 'Unlimited'}
                    </p>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <div className="bg-blue-50 px-4 py-2 rounded">
                    <p className="text-xs text-gray-600">Available Points</p>
                    <p className="text-lg font-bold text-blue-600">
                      {event.pointsRemain} / {event.pointsTotal}
                    </p>
                  </div>

                  <Button
                    onClick={() => navigate(`/events/${event.id}`)}
                  >
                    View Details & RSVP
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
