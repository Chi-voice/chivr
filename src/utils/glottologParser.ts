export interface GlottologLanguage {
  id: string;
  name: string;
  family: string;
  latitude?: number;
  longitude?: number;
  level?: string;
  status?: string;
}

export const parseGlottologCSV = async (csvPath: string): Promise<GlottologLanguage[]> => {
  try {
    const response = await fetch(csvPath);
    const csvText = await response.text();
    
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    const languages: GlottologLanguage[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Simple CSV parsing - could be improved for more complex cases
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      
      if (values.length >= headers.length) {
        const language: any = {};
        headers.forEach((header, index) => {
          language[header] = values[index] || '';
        });
        
        // Map to our interface
        const glottologLang: GlottologLanguage = {
          id: language.glottocode || language.id || `unknown-${i}`,
          name: language.name || language.Name || 'Unknown',
          family: language.family_name || language.Family || language.family || 'Unknown',
          latitude: language.latitude ? parseFloat(language.latitude) : undefined,
          longitude: language.longitude ? parseFloat(language.longitude) : undefined,
          level: language.level || undefined,
          status: language.status || undefined,
        };
        
        // Only include if we have a proper name
        if (glottologLang.name && glottologLang.name !== 'Unknown' && glottologLang.name.length > 1) {
          languages.push(glottologLang);
        }
      }
    }
    
    return languages;
  } catch (error) {
    console.error('Error parsing Glottolog CSV:', error);
    return [];
  }
};

// Cache for parsed languages
let cachedLanguages: GlottologLanguage[] | null = null;

export const getGlottologLanguages = async (): Promise<GlottologLanguage[]> => {
  if (cachedLanguages) {
    return cachedLanguages;
  }
  
  try {
    cachedLanguages = await parseGlottologCSV('/glottolog-full.csv');
    return cachedLanguages;
  } catch (error) {
    console.error('Error loading Glottolog languages:', error);
    // Fallback to the small JSON file
    try {
      const response = await fetch('/src/data/glottolog-subset.json');
      const fallbackData = await response.json();
      cachedLanguages = fallbackData;
      return cachedLanguages;
    } catch (fallbackError) {
      console.error('Error loading fallback languages:', fallbackError);
      return [];
    }
  }
};