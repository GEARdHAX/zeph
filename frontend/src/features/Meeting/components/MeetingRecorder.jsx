import { useState, useRef, useEffect } from 'react';
import { useGlobal } from 'reactn';
import { Mic, Square } from 'lucide-react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';

// Zeph AI — Meeting AI (Phase 14). Explicit, opt-in recording: nothing is
// captured until the user clicks Record, and the recording is local audio
// only (MediaRecorder on the existing local mic stream — never the remote
// participants' audio, which this client never has raw access to anyway;
// see AI-STRATEGY.md's E2EE-adjacent privacy stance applied here: the
// caller's own words are their own to opt in with, not something silently
// captured on their behalf).
//
// This component ONLY records — it does not upload or summarize. The
// backend requires the meeting to have actually ended (Meeting.endedAt)
// before it will summarize (checkMeetingSummaryEligibility's MEETING_NOT_
// ENDED), so stopping the recorder mid-call and immediately calling
// /summarize was guaranteed to 422 every time. The recorded blob is instead
// held in the `pendingMeetingRecording` global; callManager.leave() picks
// it up once the call has genuinely ended and finalizes it there — see
// finalizeMeetingRecording in callManager.js, which is what actually
// uploads, calls /summarize, and toasts the result. This component only
// needs to unmount cleanly without losing an in-progress recording.
//
// Codec choice matters for the upload step: WebM and MP4 share their
// container-level magic bytes between audio-only and video streams, so the
// backend's upload sniffer (backend/src/utils/sniffFileCategory.js — never
// trusts a client-claimed MIME type) can't tell an audio-only WebM/MP4 blob
// apart from a video one and always classifies it as 'video', which then
// fails the meeting-audio lookup. Ogg/Opus has an unambiguous signature
// ('OggS'), so it's preferred whenever MediaRecorder supports it (Chrome/
// Firefox/Edge). Browsers without Ogg support (notably Safari/iOS) fall
// back to isMeetingAudioFallback=true, which callManager.js's finalize step
// uses to route the upload through a dedicated meeting-audio endpoint
// instead of the general /api/upload/media pipeline.
const PREFERRED_MIME_TYPES = ['audio/ogg;codecs=opus', 'audio/ogg'];
const pickRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return { mimeType: undefined, isMeetingAudioFallback: true };
  const supported = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return supported ? { mimeType: supported, isMeetingAudioFallback: false } : { mimeType: undefined, isMeetingAudioFallback: true };
};

function MeetingRecorder({ meetingId }) {
  const [audioStream] = useGlobal('audioStream');
  const setPendingRecording = useGlobal('pendingMeetingRecording')[1];
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(
    () => () => {
      // Unmounting (navigating away, the call ending) while still recording
      // must still capture what was said, not silently drop it — stop()
      // flushes the final ondataavailable chunk before firing onstop.
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    },
    [],
  );

  const handleRecordingComplete = () => {
    if (chunksRef.current.length === 0) return;
    const { mimeType, isMeetingAudioFallback } = mediaRecorderRef.current._recordingChoice;
    const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
    setPendingRecording({ meetingId, blob, mimeType: mimeType || 'audio/webm', isMeetingAudioFallback });
    toast.success("Recording saved — you'll get an AI summary once the meeting ends.");
  };

  const startRecording = () => {
    if (!audioStream) {
      toast.error('Turn on your microphone before recording.');
      return;
    }
    chunksRef.current = [];
    const choice = pickRecordingMimeType();
    const recorder = new MediaRecorder(audioStream, choice.mimeType ? { mimeType: choice.mimeType } : undefined);
    recorder._recordingChoice = choice; // stashed for handleRecordingComplete — MediaRecorder has no other slot for caller metadata
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = handleRecordingComplete;
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={recording ? stopRecording : startRecording}
      title={recording ? 'Stop recording' : 'Record meeting for an AI summary (available after the call ends)'}
      aria-label={recording ? 'Stop recording' : 'Record meeting for an AI summary'}
      className="h-12 w-12 shrink-0 rounded-full text-white shadow-md transition-transform active:scale-95 sm:h-14 sm:w-14 bg-white/10 hover:bg-white/20"
    >
      {recording ? <Square className="h-5 w-5 text-destructive" fill="currentColor" /> : <Mic className="h-5 w-5" />}
    </Button>
  );
}

export default MeetingRecorder;
