import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'es' | 'ar' | 'fr' | 'el';

export interface TranslationDictionary {
  brandTagline: string;
  exploreDebates: string;
  newDebate: string;
  viewGraph: string;
  viewSteelman: string;
  viewDiff: string;
  forkDebate: string;
  aiAnalyze: string;
  searchDebates: string;
  signIn: string;
  signUp: string;
  signOut: string;
  profile: string;
  selectedClaim: string;
  rootClaim: string;
  addClaim: string;
  supports: string;
  refutes: string;
  clarifies: string;
  needsEvidence: string;
  activeCollaborators: string;
  reputation: string;
  deleteAccount: string;
  languageName: string;
}

export const TRANSLATIONS: Record<Language, TranslationDictionary> = {
  en: {
    brandTagline: 'Ratio, in the open.',
    exploreDebates: 'Explore Debates',
    newDebate: 'New Debate',
    viewGraph: 'Graph Canvas',
    viewSteelman: 'Steelman Dialectic',
    viewDiff: 'Visual Diff',
    forkDebate: 'Fork Debate',
    aiAnalyze: 'AI Structural Logic',
    searchDebates: 'Search Claims (Ctrl+F)',
    signIn: 'Sign In',
    signUp: 'Sign Up',
    signOut: 'Sign Out',
    profile: 'Profile',
    selectedClaim: 'SELECTED CLAIM',
    rootClaim: 'THE ROOT CLAIM',
    addClaim: 'Add Claim to Stele',
    supports: 'SUPPORTS',
    refutes: 'REFUTES',
    clarifies: 'CLARIFIES',
    needsEvidence: 'NEEDS EVIDENCE',
    activeCollaborators: 'Live Agora SSE',
    reputation: 'rep',
    deleteAccount: 'Delete Account & Scrub Data (GDPR)',
    languageName: 'English',
  },
  es: {
    brandTagline: 'La razón, al descubierto.',
    exploreDebates: 'Explorar Debates',
    newDebate: 'Nuevo Debate',
    viewGraph: 'Lienzo de Grafo',
    viewSteelman: 'Modo Hombre de Acero',
    viewDiff: 'Diferencias Visuales',
    forkDebate: 'Bifurcar Debate',
    aiAnalyze: 'Lógica Estructural IA',
    searchDebates: 'Buscar Afirmaciones (Ctrl+F)',
    signIn: 'Iniciar Sesión',
    signUp: 'Registrarse',
    signOut: 'Cerrar Sesión',
    profile: 'Perfil',
    selectedClaim: 'AFIRMACIÓN SELECCIONADA',
    rootClaim: 'AFIRMACIÓN PRINCIPAL',
    addClaim: 'Añadir Afirmación a la Estela',
    supports: 'RESPALDA',
    refutes: 'REFUTA',
    clarifies: 'ACLARA',
    needsEvidence: 'REQUIERE EVIDENCIA',
    activeCollaborators: 'Ágora en Vivo SSE',
    reputation: 'rep',
    deleteAccount: 'Eliminar Cuenta y Datos (GDPR)',
    languageName: 'Español',
  },
  ar: {
    brandTagline: 'المنطق والبرهان، في العلن.',
    exploreDebates: 'استكشاف المناظرات',
    newDebate: 'مناظرة جديدة',
    viewGraph: 'مخطط الحجج',
    viewSteelman: 'الجدلية الفضلى',
    viewDiff: 'المقارنة البصرية',
    forkDebate: 'تفريغ المناظرة',
    aiAnalyze: 'التحليل المنطقي الذكي',
    searchDebates: 'بحث في الحجج (Ctrl+F)',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    signOut: 'تسجيل الخروج',
    profile: 'الملف الشخصي',
    selectedClaim: 'الحجة المحددة',
    rootClaim: 'الحجة الأساسية',
    addClaim: 'إضافة حجة جديدة',
    supports: 'يؤيد',
    refutes: 'يدحض',
    clarifies: 'يوضح',
    needsEvidence: 'يحتاج دليلاً',
    activeCollaborators: 'الأغورا المباشرة',
    reputation: 'سمعة',
    deleteAccount: 'حذف الحساب ومحو البيانات (GDPR)',
    languageName: 'العربية',
  },
  fr: {
    brandTagline: 'La raison, à ciel ouvert.',
    exploreDebates: 'Explorer les Débats',
    newDebate: 'Nouveau Débat',
    viewGraph: 'Graphe Dialectique',
    viewSteelman: 'Mode Homme d’Airain',
    viewDiff: 'Différence Visuelle',
    forkDebate: 'Bifurquer le Débat',
    aiAnalyze: 'Logique Structurelle IA',
    searchDebates: 'Rechercher (Ctrl+F)',
    signIn: 'Connexion',
    signUp: 'Inscription',
    signOut: 'Déconnexion',
    profile: 'Profil',
    selectedClaim: 'ARGUMENT SÉLECTIONNÉ',
    rootClaim: 'ARGUMENT RACINE',
    addClaim: 'Ajouter un Argument',
    supports: 'SOUTIENT',
    refutes: 'RÉFUTE',
    clarifies: 'CLARIFIE',
    needsEvidence: 'PREUVE REQUISE',
    activeCollaborators: 'Agora en Direct SSE',
    reputation: 'rep',
    deleteAccount: 'Supprimer le compte (RGPD)',
    languageName: 'Français',
  },
  el: {
    brandTagline: 'Λόγος καὶ διάλεκτος εἰς τὸ φῶς.',
    exploreDebates: 'Διερεύνηση Διαλόγων',
    newDebate: 'Νέος Διάλογος',
    viewGraph: 'Διαλεκτικός Πίναξ',
    viewSteelman: 'Κρείττων Λόγος',
    viewDiff: 'Σύγκριση Ἐκδόσεων',
    forkDebate: 'Διακλάδωση',
    aiAnalyze: 'Λογική Ἀνάλυσις AI',
    searchDebates: 'Ἀναζήτησις (Ctrl+F)',
    signIn: 'Εἴσοδος',
    signUp: 'Ἐγγραφή',
    signOut: 'Ἔξοδος',
    profile: 'Προφίλ',
    selectedClaim: 'ΕΠΙΛΕΓΜΕΝΟΣ ΛΟΓΟΣ',
    rootClaim: 'ΑΡΧΙΚΟΣ ΛΟΓΟΣ',
    addClaim: 'Προσθήκη Λόγου',
    supports: 'ΣΤΗΡΙΖΕΙ',
    refutes: 'ΑΝΑΣΚΕΥΑΖΕΙ',
    clarifies: 'ΔΙΑΣΑΦΗΝΙΖΕΙ',
    needsEvidence: 'ΔΕΕΙ ΤΕΚΜΗΡΙΟΥ',
    activeCollaborators: 'Ζῶσα Ἀγορά',
    reputation: 'κῦρος',
    deleteAccount: 'Διαγραφή Λογαριασμού (GDPR)',
    languageName: 'Ἑλληνικά',
  },
};

interface I18nContextType {
  language: Language;
  t: TranslationDictionary;
  setLanguage: (lang: Language) => void;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType>({
  language: 'en',
  t: TRANSLATIONS.en,
  setLanguage: () => {},
  isRtl: false,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('argus_lang') as Language;
    if (saved && TRANSLATIONS[saved]) return saved;
    const browserLang = navigator.language?.slice(0, 2)?.toLowerCase();
    if (browserLang && TRANSLATIONS[browserLang as Language]) return browserLang as Language;
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('argus_lang', lang);
  };

  const isRtl = language === 'ar';

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language, isRtl]);

  return (
    <I18nContext.Provider value={{ language, t: TRANSLATIONS[language], setLanguage, isRtl }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useTranslation() {
  const ctx = useContext(I18nContext);
  return ctx ?? {
    language: 'en' as Language,
    t: TRANSLATIONS.en,
    setLanguage: () => {},
    isRtl: false,
  };
}
