import { useState, useRef, useEffect } from 'react';
import { useGlobal } from 'reactn';
import { Mic, Square, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import uploadMedia from '../../../actions/uploadMedia';
import summarizeMeeting from '../../../actions/summarizeMeeting';
import getMeetingSummary from '../../../actions/getMeetingSummary';
import { getAiErrorMessage } from '../../../lib/aiErrorMessage';

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

function MeetingRecorder({ meetingId }) {
  const [audioStream] = useGlobal('audioStream');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const pollTimeoutRef = useRef(null);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    clearTimeout(pollTimeoutRef.current);
    abortRef.current?.abort();
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  }, []);

  const startRecording = () => {
    if (!audioStream) {
      toast.error('Turn on your microphone before recording.');
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(audioStream);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
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
      if (res.data.status === 'SUMMARIZED') {
        setProcessing(false);
        setSummary(res.data.summary);
        return;
      }
      if (res.data.status === 'FAILED') {
        setProcessing(false);
        setError('Could not generate a summary for this meeting.');
        return;
      }
      pollTimeoutRef.current = setTimeout(pollForSummary, POLL_INTERVAL_MS);
    } catch (e) {
      if (!mountedRef.current) return;
      setProcessing(false);
      setError(getAiErrorMessage(e));
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
        pollForSummary();
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

      <Dialog open={!!summary || !!error} onOpenChange={(next) => { if (!next) { setSummary(null); setError(null); } }}>
        <DialogContent className="rounded-2xl border border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Meeting Summary
            </DialogTitle>
            {summary && <DialogDescription>AI-generated — may be inaccurate.</DialogDescription>}
          </DialogHeader>
          {error ? (
            <p className="text-xs leading-relaxed text-destructive">{error}</p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">{summary}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MeetingRecorder;
