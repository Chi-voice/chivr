import React from 'react';
import LanguageSelector from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';

const GlobalHeader: React.FC = () => {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center space-x-3">
      <LanguageSelector />
      <ThemeToggle />
    </div>
  );
};

export default GlobalHeader;
