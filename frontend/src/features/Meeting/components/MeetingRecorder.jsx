import { useState, useRef, useEffect } from 'react';
import { useGlobal } from 'reactn';
import { Mic, Square, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ZephGeneratingLoader } from '@/components/ui/ZephGeneratingLoader';
import uploadMedia from '../../../actions/uploadMedia';
import summarizeMeeting from '../../../actions/summarizeMeeting';
import getMeetingSummary from '../../../actions/getMeetingSummary';
import { getAiErrorMessage, MESSAGES } from '../../../lib/aiErrorMessage';

// Zeph AI — Meeting AI (Phase 14). Explicit, opt-in recording: nothing is
// captured until the user clicks Record, and the recording is local audio
// only (MediaRecorder on the existing local mic stream — never the remote
// participants' audio, which this client never has raw access to anyway;
// see AI-STRATEGY.md's E2EE-adjacent privacy stance applied here: the
// caller's own words are their own to opt in with, not something silently
// captured on their behalf). Uploads via the existing upload-media pipeline
// (audio category), then triggers the backend's transcribe+summarize flow
// and polls for the async result if BullMQ is handling it.
const POLL_INTERVAL_MS = 4000;

// The BullMQ path (transcribe → eligibility → summarize) is normally well
// under a minute; 3 minutes is a generous ceiling that still guarantees the
// dialog can never spin forever if the job dies silently, the transcript
// gets stuck on a non-terminal status, or a stale dedup lock keeps every
// retry from starting.
const POLL_DEADLINE_MS = 3 * 60 * 1000;

function MeetingRecorder({ meetingId }) {
  const [audioStream] = useGlobal('audioStream');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [canRetry, setCanRetry] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const pollTimeoutRef = useRef(null);
  const pollDeadlineRef = useRef(0);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      clearTimeout(pollTimeoutRef.current);
      abortRef.current?.abort();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    },
    [],
  );

  const startRecording = () => {
    if (!audioStream) {
      toast.error('Turn on your microphone before recording.');
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(audioStream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => handleRecordingComplete();
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
    setError(null);
    setSummary(null);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const pollForSummary = async () => {
    if (!mountedRef.current) return;
    try {
      const res = await getMeetingSummary(meetingId);
      const { status } = res.data;
      if (status === 'SUMMARIZED') {
        setProcessing(false);
        setSummary(res.data.summary);
        return;
      }
      if (status === 'FAILED') {
        setProcessing(false);
        setError(MESSAGES[res.data.failureReason] || 'Could not generate a summary for this meeting.');
        // A transcript exists but summarizing failed transiently — a retry
        // is worth offering. Eligibility verdicts are permanent, so not those.
        setCanRetry(res.data.failureReason === 'SUMMARY_FAILED' || res.data.failureReason === 'INVALID_OUTPUT');
        return;
      }
      // Non-terminal (TRANSCRIBING / TRANSCRIBED / SUMMARIZING). Keep
      // polling — but never past the deadline: a job can die silently or a
      // stale dedup lock can block every retry, and the dialog must not
      // spin forever.
      if (Date.now() > pollDeadlineRef.current) {
        setProcessing(false);
        setError('This is taking longer than expected. You can try again.');
        setCanRetry(true);
        return;
      }
      pollTimeoutRef.current = setTimeout(pollForSummary, POLL_INTERVAL_MS);
    } catch (e) {
      if (!mountedRef.current) return;
      setProcessing(false);
      setError(getAiErrorMessage(e));
    }
  };

  const startPolling = () => {
    pollDeadlineRef.current = Date.now() + POLL_DEADLINE_MS;
    pollForSummary();
  };

  const retry = async () => {
    setError(null);
    setCanRetry(false);
    setProcessing(true);
    try {
      // No mediaId — the transcript already exists server-side; this just
      // re-runs summary generation.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await summarizeMeeting(meetingId, null, controller.signal);
      if (res.status === 202) {
        startPolling();
        return;
      }
      setProcessing(false);
      setSummary(res.data.summary);
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return;
      if (!mountedRef.current) return;
      setProcessing(false);
      setError(getAiErrorMessage(e));
      setCanRetry(true);
    }
  };

  const handleRecordingComplete = async () => {
    if (chunksRef.current.length === 0) return;
    setProcessing(true);
    setError(null);
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const file = new File([blob], `meeting-${meetingId}.webm`, { type: 'audio/webm' });

    try {
      const uploadRes = await uploadMedia(file);
      const mediaId = uploadRes.data.media._id;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const summarizeRes = await summarizeMeeting(meetingId, mediaId, controller.signal);

      if (summarizeRes.status === 202) {
        startPolling();
        return;
      }
      setProcessing(false);
      setSummary(summarizeRes.data.summary);
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return;
      if (!mountedRef.current) return;
      setProcessing(false);
      setError(getAiErrorMessage(e));
    }
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={processing}
        onClick={recording ? stopRecording : startRecording}
        title={recording ? 'Stop recording & summarize' : 'Record meeting for an AI summary'}
        aria-label={recording ? 'Stop recording & summarize' : 'Record meeting for an AI summary'}
        className="h-12 w-12 shrink-0 rounded-full text-white shadow-md transition-transform active:scale-95 sm:h-14 sm:w-14 bg-white/10 hover:bg-white/20"
      >
        {processing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : recording ? (
          <Square className="h-5 w-5 text-destructive" fill="currentColor" />
        ) : (
          <Mic className="h-5 w-5" />
        )}
      </Button>

      <Dialog
        open={processing || !!summary || !!error}
        onOpenChange={(next) => {
          if (!next && !processing) {
            setSummary(null);
            setError(null);
            setCanRetry(false);
          }
        }}
      >
        <DialogContent className="rounded-2xl border border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Meeting Summary
            </DialogTitle>
            {summary && <DialogDescription>AI-generated — may be inaccurate.</DialogDescription>}
            {processing && <DialogDescription>AI transcription and summarization in progress</DialogDescription>}
          </DialogHeader>
          {processing ? (
            <div className="py-6 flex items-center justify-center">
              <ZephGeneratingLoader
                size={160}
                text="Summarizing"
                subtext="Transcribing audio & synthesizing meeting notes..."
              />
            </div>
          ) : error ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-destructive">{error}</p>
              {canRetry && (
                <Button type="button" size="sm" onClick={retry} className="self-start">
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{summary}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MeetingRecorder;
