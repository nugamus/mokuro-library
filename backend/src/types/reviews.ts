export interface ReviewRequestEntry {
  id: string; // Branch ID
  volumeId: string;
  volumeTitle: string;
  seriesId: string;
  seriesTitle: string;
  coverImageName: string | null;

  // Review Metadata
  userId: string;
  userDisplayName?: string; // Helpful for Admin view
  submittedAt: Date;        // Actually updatedAt when isPendingReview became true
  submissionNote: string | null;
  rejectionReason: string | null;

  // Version Info
  headPatchId: string;
  isBehind: boolean;
}

export interface ReviewStatusParams {
  volumeId: string;
  status: boolean;       // true = Request Review, false = Cancel/Reject
  reason?: string;       // Optional note
  targetUserId?: string; // Required for Admin to target a specific user's branch
}

export interface ReviewStatusResult {
  volumeId: string;
  status: boolean;
  action: 'submitted' | 'cancelled' | 'rejected' | 'accepted';
}
