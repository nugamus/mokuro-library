// frontend/src/routes/contributions/submissions/[id]/+page.ts
import type { PageLoad } from './$types';
import type { Submission } from '$lib/types';

export const load: PageLoad = async ({ params, fetch }) => {
  const { id } = params;

  async function getSubmission(submissionId: string): Promise<Submission> {
    const response = await fetch(`/api/contributions/submissions/${submissionId}`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to fetch submission (status: ${response.status})`);
    }
    return response.json();
  }

  return {
    submission: await getSubmission(id)
  };
};
