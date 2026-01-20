import { apiFetch } from './api';
import type { ReviewRequestEntry, ReviewStatusParams, ReviewStatusResult } from '$lib/types';

/**
 * Fetches pending review requests.
 * The backend automatically determines if it returns "My Requests" (User)
 * or "All Requests" (Admin) based on the session.
 */
export async function getReviews(): Promise<ReviewRequestEntry[]> {
  const data = await apiFetch<{ reviews: ReviewRequestEntry[] }>('/api/contributions/reviews');
  return data.reviews;
}

/**
 * Toggles the review status.
 * - User: Request Review (true) or Cancel (false)
 * - Admin: Reject (false)
 */
export async function setReviewStatus(params: ReviewStatusParams): Promise<ReviewStatusResult> {
  return await apiFetch<ReviewStatusResult>('/api/contributions/reviews/set', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}
