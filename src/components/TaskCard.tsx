import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Volume2, Clock, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export interface Task {
  id: string;
  type: 'word' | 'phrase' | 'sentence';
  englishText: string;
  description?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number; // in minutes
  sequenceOrder?: number;
  isStarterTask?: boolean;
  isCompleted?: boolean;
}

interface TaskCardProps {
  task: Task;
  onStart: (task: Task) => void;
  className?: string;
}

const typeColors = {
  word: 'bg-earth-accent text-earth-deep',
  phrase: 'bg-earth-secondary text-earth-deep', 
  sentence: 'bg-earth-primary text-white'
};

const difficultyColors = {
  beginner: 'bg-green-100 text-green-800',
  intermediate: 'bg-yellow-100 text-yellow-800',
  advanced: 'bg-red-100 text-red-800'
};

export const TaskCard: React.FC<TaskCardProps> = ({ task, onStart, className }) => {
  const { t } = useTranslation();
  const typeIcon = {
    word: '📝',
    phrase: '💬', 
    sentence: '📖'
  };

  return (
    <Card className={cn(
      "transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4",
      task.isCompleted ? "border-l-green-500 bg-green-50/50" : "border-l-earth-primary",
      className
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">{typeIcon[task.type]}</span>
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">
                {t(`task.type.${task.type}`)} {t('task.translation')}
              </CardTitle>
              <div className="flex items-center space-x-2 mt-1">
                <Badge className={typeColors[task.type]} variant="secondary">
                  {t(`task.type.${task.type}`)}
                </Badge>
                <Badge className={difficultyColors[task.difficulty]} variant="secondary">
                  {t(`task.difficulty.${task.difficulty}`)}
                </Badge>
              </div>
            </div>
          </div>
          {task.isCompleted && (
            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* English Text to Translate */}
        <div className="bg-earth-warm p-4 rounded-lg border-l-4 border-earth-primary">
          <div className="flex items-center space-x-2 mb-2">
            <Volume2 className="w-4 h-4 text-earth-primary" />
            <span className="text-sm font-medium text-earth-deep">{t('task.englishText')}</span>
          </div>
          <p className="text-foreground font-medium text-lg">"{task.englishText}"</p>
        </div>

        {/* Description */}
        {task.description && (
          <p className="text-muted-foreground text-sm">{task.description}</p>
        )}

        {/* Task Info */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center space-x-1">
            <Clock className="w-4 h-4" />
            <span>{t('task.approxMinutes', { minutes: task.estimatedTime })}</span>
          </div>
          <span className="text-xs opacity-70">{t('task.id')}: {task.id.slice(0, 8)}</span>
        </div>

        {/* Action Button */}
        <Button 
          onClick={() => onStart(task)}
          className={cn(
            "w-full transition-all duration-300",
            task.isCompleted 
              ? "bg-green-600 hover:bg-green-700" 
              : "bg-earth-primary hover:bg-earth-primary/90"
          )}
          disabled={task.isCompleted}
        >
          {task.isCompleted ? t('task.completed') : t('task.startRecording')}
        </Button>
      </CardContent>
    </Card>
  );
};