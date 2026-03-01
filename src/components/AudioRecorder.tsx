import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Mic, MicOff, Play, Pause, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  maxDuration?: number;
  className?: string;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onRecordingComplete,
  maxDuration = 30,
  className
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const waveformIntervalRef = useRef<number | null>(null);
  const autoStopTimeoutRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isRecordingRef = useRef(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      // Set up audio analysis for waveform
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioCtx();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;

      // Choose best supported MIME type for this browser
      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
      const selectedType = preferredTypes.find((t) => {
        try {
          return (window as any).MediaRecorder?.isTypeSupported?.(t);
        } catch {
          return false;
        }
      }) || '';

      const mediaRecorder = selectedType
        ? new MediaRecorder(stream, { mimeType: selectedType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        try {
          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());

          // Determine final blob type
          const finalType = chunks[0]?.type || mediaRecorder.mimeType || selectedType || 'audio/webm';
          
          if (!chunks.length) {
            toast({
              title: t('recorder.noAudioCapturedTitle') ?? 'No audio captured',
              description: t('recorder.noAudioCapturedDesc') ?? 'Please try recording again.',
              variant: 'destructive',
            });
            return;
          }

          const totalSize = chunks.reduce((acc, b) => acc + b.size, 0);
          if (totalSize < 1024) {
            toast({
              title: t('recorder.tooShortTitle') ?? 'Recording too short',
              description: t('recorder.tooShortDesc') ?? 'Please hold the mic and try again.',
              variant: 'destructive',
            });
            return;
          }
          
          const blob = new Blob(chunks, { type: finalType });
          setAudioBlob(blob);
          setAudioUrl(URL.createObjectURL(blob));
          onRecordingComplete(blob);
        } finally {
          // Cleanup analysis resources
          try { audioContextRef.current?.close(); } catch {}
          analyserRef.current = null;
          dataArrayRef.current = null;
          isRecordingRef.current = false;
        }
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingTime(0);
      setWaveformData([]);
      
      // Update waveform during recording
      const updateWaveform = () => {
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          const average = dataArrayRef.current.reduce((a, b) => a + b, 0) / dataArrayRef.current.length;
          setWaveformData(prev => [...prev.slice(-50), average / 255]);
        }
      };
      
      waveformIntervalRef.current = window.setInterval(updateWaveform, 100);
      
      // Timer
      intervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= maxDuration) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
      
      // Auto-stop at max duration
      autoStopTimeoutRef.current = window.setTimeout(() => {
        if (isRecordingRef.current) {
          stopRecording();
        }
      }, maxDuration * 1000);
      
    } catch (error: any) {
      console.error('Error accessing microphone:', error);
      toast({
        title: t('recorder.permissionDeniedTitle') ?? 'Microphone error',
        description: (error?.message || (t('recorder.permissionDeniedDesc') as any)) ?? 'Please allow microphone access and try again.',
        variant: 'destructive',
      });
      isRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.stop();
    }
    setIsRecording(false);
    isRecordingRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (waveformIntervalRef.current) {
      clearInterval(waveformIntervalRef.current);
      waveformIntervalRef.current = null;
    }
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
  };

  const togglePlayback = () => {
    if (!audioPlayerRef.current || !audioUrl) return;
    
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.play();
      setIsPlaying(true);
    }
  };

  const resetRecording = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    setWaveformData([]);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (audioUrl) {
      audioPlayerRef.current = new Audio(audioUrl);
      audioPlayerRef.current.onended = () => setIsPlaying(false);
    }
    
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (waveformIntervalRef.current) clearInterval(waveformIntervalRef.current);
      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
      try { audioContextRef.current?.close(); } catch {}
    };
  }, [audioUrl]);

  const progress = (recordingTime / maxDuration) * 100;

  return (
    <Card className={cn("w-full max-w-md mx-auto", className)}>
      <CardContent className="p-6 space-y-4">
        {/* Waveform Visualization */}
        <div className="h-16 bg-earth-warm rounded-lg flex items-end justify-center px-2 overflow-hidden">
          {waveformData.map((amplitude, index) => (
            <div
              key={index}
              className={cn(
                "w-1 mx-0.5 rounded-t transition-all duration-100",
                isRecording ? "bg-recording-active" : "bg-earth-primary"
              )}
              style={{
                height: `${Math.max(4, amplitude * 60)}px`,
                opacity: isRecording ? 1 : 0.6
              }}
            />
          ))}
        </div>

        {/* Recording Controls */}
        <div className="flex items-center justify-center space-x-4">
          {!audioBlob ? (
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              size="lg"
              className={cn(
                "w-16 h-16 rounded-full transition-all duration-300",
                isRecording 
                  ? "bg-recording-active hover:bg-recording-active/90 animate-pulse" 
                  : "bg-earth-primary hover:bg-earth-primary/90"
              )}
            >
              {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </Button>
          ) : (
            <>
              <Button
                onClick={togglePlayback}
                size="lg"
                variant="outline"
                className="w-12 h-12 rounded-full"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </Button>
              <Button
                onClick={resetRecording}
                size="lg"
                variant="outline"
                className="w-12 h-12 rounded-full"
              >
                <RotateCcw className="w-5 h-5" />
              </Button>
            </>
          )}
        </div>

        {/* Recording Progress */}
        {(isRecording || recordingTime > 0) && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
              <span>{Math.floor(maxDuration / 60)}:{(maxDuration % 60).toString().padStart(2, '0')}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Status Text */}
        <div className="text-center text-sm text-muted-foreground">
          {isRecording 
            ? t('recorder.recordingInProgress') 
            : audioBlob 
            ? t('recorder.recordingComplete') 
            : t('recorder.tapToStart')
          }
        </div>
      </CardContent>
    </Card>
  );
};