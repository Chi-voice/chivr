import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number;
  total?: number;
  icon: LucideIcon;
  description?: string;
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'gold';
  className?: string;
}

const colorClasses = {
  primary: 'text-earth-primary bg-earth-primary/10',
  secondary: 'text-earth-secondary bg-earth-secondary/10',
  success: 'text-green-600 bg-green-100',
  warning: 'text-yellow-600 bg-yellow-100',
  gold: 'text-yellow-600 bg-yellow-100'
};

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  total,
  icon: Icon,
  description,
  color = 'primary',
  className
}) => {
  const percentage = total ? (value / total) * 100 : 0;
  
  return (
    <Card className={cn("transition-all duration-300 hover:shadow-md", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className={cn("p-2 rounded-full", colorClasses[color])}>
          <Icon className="w-4 h-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-foreground">
              {value}
            </span>
            {total && (
              <span className="text-sm text-muted-foreground">
                / {total}
              </span>
            )}
          </div>
          
          {total && (
            <div className="space-y-1">
              <Progress 
                value={percentage} 
                className="h-2"
              />
              <div className="text-xs text-muted-foreground text-right">
                {percentage.toFixed(0)}% complete
              </div>
            </div>
          )}
          
          {description && (
            <p className="text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};