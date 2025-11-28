import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { Button } from '../components/ui/button';

const TRANSACTION_COLORS = {
  purchase: 'bg-green-50 border-green-200 text-green-800',
  transfer: 'bg-blue-50 border-blue-200 text-blue-800',
  redemption: 'bg-red-50 border-red-200 text-red-800',
  adjustment: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  event: 'bg-purple-50 border-purple-200 text-purple-800'
};

export const TransactionsPage = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [limit] = useState(10);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [orderBy, setOrderBy] = useState('createdAt');
  const [orderDir, setOrderDir] = useState('desc');

  useEffect(() => {
    fetchTransactions();
  }, [page, typeFilter, minAmount, maxAmount, orderBy, orderDir]);

  const fetchTransactions = async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString()
      });

      if (typeFilter) params.append('type', typeFilter);
      if (minAmount) params.append('minAmount', minAmount);
      if (maxAmount) params.append('maxAmount', maxAmount);
      if (orderBy) {
        params.append('orderBy', `${orderDir === 'asc' ? '' : '-'}${orderBy}`);
      }

      const response = await apiClient.get(`/users/me/transactions?${params}`);

      // Fetch additional data for each transaction to get sender/receiver names
      const transactionsWithNames = await Promise.all(
        (response.data.results || []).map(async (tx) => {
          let relatedName = null;
          if (tx.relatedId && tx.type === 'transfer') {
            try {
              // For transfers, fetch the related user's name
              const relatedUser = await apiClient.get(`/users/${tx.relatedId}`);
              relatedName = relatedUser.data.utorid;
            } catch (err) {
              console.error('Failed to fetch related user:', err);
            }
          }
          return { ...tx, relatedName };
        })
      );

      setTransactions(transactionsWithNames);
      setTotalCount(response.data.count || 0);
    } catch (err) {
      setError('Failed to load transactions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTypeFilter('');
    setMinAmount('');
    setMaxAmount('');
    setOrderBy('createdAt');
    setOrderDir('desc');
    setPage(1);
  };

  const totalPages = Math.ceil(totalCount / limit);

  const renderTransactionDetail = (tx) => {
    switch (tx.type) {
      case 'purchase':
        return (
          <div className="text-sm">
            <p>Spent: ${tx.spent?.toFixed(2) || 'N/A'}</p>
            {tx.promotions && tx.promotions.length > 0 && (
              <p className="text-green-600">Promotions applied: {tx.promotions.length}</p>
            )}
          </div>
        );
      case 'transfer':
        return (
          <div className="text-sm">
            <p>
              {tx.amount > 0 ? 'From' : 'To'}: {tx.relatedName || `User #${tx.relatedId}`}
            </p>
          </div>
        );
      case 'redemption':
        return (
          <div className="text-sm">
            <p>Status: {tx.processedById ? 'Processed' : 'Pending'}</p>
          </div>
        );
      case 'event':
        return (
          <div className="text-sm">
            <p>Event points awarded</p>
          </div>
        );
      case 'adjustment':
        return (
          <div className="text-sm">
            <p>Manual adjustment</p>
            {tx.suspicious && <p className="text-red-600">Flagged as suspicious</p>}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">My Transactions</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Filters & Sorting</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Types</option>
              <option value="purchase">Purchase</option>
              <option value="transfer">Transfer</option>
              <option value="redemption">Redemption</option>
              <option value="adjustment">Adjustment</option>
              <option value="event">Event</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Amount
            </label>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => { setMinAmount(e.target.value); setPage(1); }}
              placeholder="Min"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Amount
            </label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => { setMaxAmount(e.target.value); setPage(1); }}
              placeholder="Max"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sort By
            </label>
            <div className="flex gap-2">
              <select
                value={orderBy}
                onChange={(e) => setOrderBy(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="createdAt">Date</option>
                <option value="amount">Amount</option>
                <option value="type">Type</option>
              </select>
              <select
                value={orderDir}
                onChange={(e) => setOrderDir(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="desc">↓</option>
                <option value="asc">↑</option>
              </select>
            </div>
          </div>
        </div>

        <Button onClick={handleReset} variant="outline" className="w-full md:w-auto">
          Reset Filters
        </Button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-lg">Loading transactions...</div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-4">{error}</div>
      )}

      {/* Transactions List */}
      {!loading && !error && (
        <>
          {transactions.length === 0 ? (
            <div className="bg-gray-50 p-8 rounded-lg text-center text-gray-600">
              No transactions found
            </div>
          ) : (
            <div className="space-y-4">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className={`border-2 rounded-lg p-6 ${TRANSACTION_COLORS[tx.type] || 'bg-gray-50'}`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-white rounded font-semibold text-sm uppercase">
                        {tx.type}
                      </span>
                      <span className="text-sm text-gray-600">
                        {new Date(tx.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.amount >= 0 ? '+' : ''}{tx.amount}
                      </p>
                      <p className="text-sm text-gray-600">points</p>
                    </div>
                  </div>

                  <div className="mb-3">
                    {renderTransactionDetail(tx)}
                  </div>

                  {tx.remark && (
                    <div className="bg-white bg-opacity-50 p-3 rounded">
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">Remark:</span> {tx.remark}
                      </p>
                    </div>
                  )}

                  <div className="mt-3 text-xs text-gray-500">
                    Transaction ID: {tx.id}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <Button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                variant="outline"
              >
                Previous
              </Button>

              <div className="flex items-center gap-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }

                  return (
                    <Button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      variant={page === pageNum ? 'default' : 'outline'}
                      className="w-10"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>

              <Button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                variant="outline"
              >
                Next
              </Button>
            </div>
          )}

          <div className="text-center text-sm text-gray-600 mt-4">
            Showing {transactions.length} of {totalCount} transactions
          </div>
        </>
      )}
    </div>
  );
};
