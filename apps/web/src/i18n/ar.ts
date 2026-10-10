export const ar = {
  brand: 'راصد',
  tagline: 'رادار النمو لمتاجر سلة',
  nav: { overview: 'نظرة عامة', tracking: 'سلامة التتبع', competitors: 'المنافسون', decisions: 'القرارات', settings: 'الإعدادات' },
  common: { language: 'English', theme: 'المظهر', light: 'فاتح', dark: 'داكن', system: 'تلقائي', store: 'المتجر', logout: 'تسجيل الخروج', updated: 'آخر تحديث' },
  login: {
    title: 'ادخل إلى راصد',
    subtitle: 'اربط متجرك في سلة لتعرف مدى موثوقية أرقامك وما يجب فعله الآن.',
    cta: 'الدخول عبر سلة',
    errors: {
      denied: 'تم رفض الإذن من سلة.',
      invalid: 'انتهت صلاحية طلب الدخول. حاول مرة أخرى.',
      forbidden: 'هذا المتجر مرتبط بحساب آخر. اطلب دعوة من مالك المتجر.',
      failed: 'تعذر إكمال الربط. حاول لاحقاً.',
    },
  },
  overview: {
    title: 'مركز القيادة',
    subtitle: 'ملخص تنفيذي لموثوقية البيانات والقرارات الأهم.',
    empty: 'لا توجد بيانات بعد. جارٍ مزامنة متجرك من سلة.',
    apiDown: 'تعذر الوصول إلى الخادم. تُعرض بيانات تجريبية.',
  },
  confidence: {
    title: 'موثوقية البيانات',
    levels: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة', insufficient_data: 'بيانات غير كافية' },
    hint: 'مدى تطابق أرقام سلة مع أدوات التتبع لديك.',
    checks: {
      ga4_connected: 'ربط GA4',
      purchase_event_exists: 'وجود حدث الشراء',
      revenue_match: 'تطابق الإيرادات',
      order_count_match: 'تطابق عدد الطلبات',
      data_freshness: 'حداثة البيانات',
      currency_match: 'تطابق العملة',
    },
    status: { pass: 'سليم', warn: 'تحذير', fail: 'فشل', unavailable: 'غير متاح', not_applicable: 'لا ينطبق' },
  },
  risk: { title: 'إيراد معرّض للخطر', hint: 'تقدير آخر 30 يوماً بناءً على القرارات المفتوحة.', ofRevenue: 'من إيراد 30 يوماً' },
  health: { title: 'صحة التسويق', hint: 'مزيج من موثوقية البيانات والإيراد المعرّض للخطر.', na: 'غير متاح' },
  decisions: {
    title: 'أهم 3 قرارات',
    none: 'لا توجد قرارات مفتوحة. كل شيء يبدو سليماً.',
    confidence: 'ثقة',
    atRisk: 'معرّض للخطر',
    severity: { CRITICAL: 'حرج', HIGH: 'مرتفع', MEDIUM: 'متوسط', LOW: 'منخفض' },
    category: { TRACKING: 'التتبع', PRICING: 'التسعير', COMPETITOR: 'المنافسون', INVENTORY: 'المخزون', CAMPAIGN: 'الحملات' },
  },
};
export type Dict = typeof ar;
