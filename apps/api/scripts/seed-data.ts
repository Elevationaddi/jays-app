/**
 * Local seed data. Every person, business and contact here is fictional; emails use the reserved
 * example.test domain and phones use an unallocated +97150000 range. Never run outside local/test.
 */
export const SEED_PASSWORD = 'Local-Dev-Passw0rd!';

export interface SeedUser {
  key: string;
  email?: string;
  phone?: string;
  displayName: string;
  locale: 'en' | 'ar';
  emirate: string;
}

export const SEED_USERS: SeedUser[] = [
  {
    key: 'customer.en',
    email: 'customer.en@example.test',
    displayName: 'Layla Haddad',
    locale: 'en',
    emirate: 'DXB',
  },
  {
    key: 'customer.ar',
    phone: '+971500000101',
    displayName: 'سارة المنصوري',
    locale: 'ar',
    emirate: 'AUH',
  },
  {
    key: 'customer.hybrid',
    email: 'customer.both@example.test',
    displayName: 'Omar Farouk',
    locale: 'en',
    emirate: 'SHJ',
  },
  {
    key: 'owner.noor',
    email: 'owner.noor@example.test',
    displayName: 'Noor Saleh',
    locale: 'en',
    emirate: 'DXB',
  },
  {
    key: 'owner.saffron',
    email: 'owner.saffron@example.test',
    displayName: 'Hessa Karim',
    locale: 'ar',
    emirate: 'SHJ',
  },
  {
    key: 'owner.lumiere',
    email: 'owner.lumiere@example.test',
    displayName: 'Rania Aziz',
    locale: 'en',
    emirate: 'DXB',
  },
  {
    key: 'owner.oud',
    email: 'owner.oud@example.test',
    displayName: 'Khalid Nasser',
    locale: 'ar',
    emirate: 'AUH',
  },
  {
    key: 'staff.scheduler',
    email: 'staff.scheduler@example.test',
    displayName: 'Maya Joseph',
    locale: 'en',
    emirate: 'DXB',
  },
  {
    key: 'staff.pro',
    email: 'staff.pro@example.test',
    displayName: 'Aisha Rahman',
    locale: 'en',
    emirate: 'DXB',
  },
  {
    key: 'staff.manager',
    email: 'staff.manager@example.test',
    displayName: 'Yousef Ali',
    locale: 'ar',
    emirate: 'AUH',
  },
  {
    key: 'staff.fulfillment',
    email: 'staff.fulfillment@example.test',
    displayName: 'Priya Menon',
    locale: 'en',
    emirate: 'AUH',
  },
  {
    key: 'staff.finance',
    email: 'staff.finance@example.test',
    displayName: 'Daniel Costa',
    locale: 'en',
    emirate: 'AUH',
  },
];

type Localized = { en: string; ar: string };
type Rgb = [number, number, number];

export interface SeedOnboarding {
  /** Target state. `draft` leaves the onboarding empty for trying the forms. */
  status: 'draft' | 'under_review' | 'approved';
  legalName: string;
  licenseNumber: string;
  emirate: string;
  area: string;
  storefront: { name: Localized; description: Localized };
  colors: { from: Rgb; to: Rgb; disc: Rgb };
}

export interface SeedBusiness {
  key: string;
  displayName: Localized;
  modes: ('shop' | 'services')[];
  owner: string;
  staff: { user: string; permissions: string[] }[];
  onboarding: SeedOnboarding;
}

/**
 * Two product sellers, one salon and one hybrid (docs/10-build-plan.md), plus one draft to try the
 * onboarding forms. Saffron waits in the admin review queue; the others are approved and public.
 * Licence numbers, authorities and addresses are fictional.
 */
export const SEED_BUSINESSES: SeedBusiness[] = [
  {
    key: 'noor',
    displayName: { en: 'Noor Beauty Supply', ar: 'نور لمستلزمات التجميل' },
    modes: ['shop'],
    owner: 'owner.noor',
    staff: [],
    onboarding: {
      status: 'approved',
      legalName: 'Noor Beauty Supply Trading LLC (fictional)',
      licenseNumber: 'TEST-100001',
      emirate: 'DXB',
      area: 'Al Barsha',
      storefront: {
        name: { en: 'Noor Beauty Supply', ar: 'نور لمستلزمات التجميل' },
        description: {
          en: 'Everyday makeup, skincare and haircare from trusted brands, packed and delivered by our Dubai team.',
          ar: 'مكياج وعناية يومية بالبشرة والشعر من علامات موثوقة، يجهزها ويوصلها فريقنا في دبي.',
        },
      },
      colors: { from: [122, 62, 108], to: [214, 170, 196], disc: [255, 247, 250] },
    },
  },
  {
    key: 'saffron',
    displayName: { en: 'Saffron Skin Co.', ar: 'زعفران للعناية بالبشرة' },
    modes: ['shop'],
    owner: 'owner.saffron',
    staff: [],
    onboarding: {
      status: 'under_review',
      legalName: 'Saffron Skin Co. LLC (fictional)',
      licenseNumber: 'TEST-100002',
      emirate: 'SHJ',
      area: 'Al Majaz',
      storefront: {
        name: { en: 'Saffron Skin Co.', ar: 'زعفران للعناية بالبشرة' },
        description: {
          en: 'Small-batch skincare inspired by saffron and rose, made for the UAE climate.',
          ar: 'منتجات عناية بالبشرة بكميات صغيرة مستوحاة من الزعفران والورد، مناسبة لمناخ الإمارات.',
        },
      },
      colors: { from: [176, 96, 32], to: [240, 200, 140], disc: [255, 250, 240] },
    },
  },
  {
    key: 'lumiere',
    displayName: { en: 'Lumière Salon', ar: 'صالون لوميير' },
    modes: ['services'],
    owner: 'owner.lumiere',
    staff: [
      { user: 'staff.scheduler', permissions: ['scheduler'] },
      { user: 'staff.pro', permissions: ['professional'] },
    ],
    onboarding: {
      status: 'approved',
      legalName: 'Lumiere Salon Services LLC (fictional)',
      licenseNumber: 'TEST-100003',
      emirate: 'DXB',
      area: 'Jumeirah',
      storefront: {
        name: { en: 'Lumière Salon', ar: 'صالون لوميير' },
        description: {
          en: 'Hair, nails and brows by a friendly team in Jumeirah. Book online in a few taps.',
          ar: 'خدمات الشعر والأظافر والحواجب مع فريق ودود في جميرا. احجزي عبر الإنترنت بخطوات بسيطة.',
        },
      },
      colors: { from: [40, 64, 92], to: [160, 190, 214], disc: [248, 251, 255] },
    },
  },
  {
    key: 'oud',
    displayName: { en: 'Oud & Bloom', ar: 'عود وبلوم' },
    modes: ['shop', 'services'],
    owner: 'owner.oud',
    staff: [
      { user: 'staff.manager', permissions: ['manager'] },
      { user: 'staff.fulfillment', permissions: ['fulfillment'] },
      { user: 'staff.finance', permissions: ['finance'] },
      { user: 'staff.pro', permissions: ['professional'] },
    ],
    onboarding: {
      status: 'approved',
      legalName: 'Oud and Bloom General Trading LLC (fictional)',
      licenseNumber: 'TEST-100004',
      emirate: 'AUH',
      area: 'Al Khalidiyah',
      storefront: {
        name: { en: 'Oud & Bloom', ar: 'عود وبلوم' },
        description: {
          en: 'Fragrance and bath rituals to take home, and a calm spa in Abu Dhabi to unwind.',
          ar: 'عطور وطقوس استحمام للمنزل، وسبا هادئ في أبوظبي للاسترخاء.',
        },
      },
      colors: { from: [64, 40, 32], to: [196, 150, 110], disc: [252, 246, 238] },
    },
  },
  {
    key: 'amber',
    displayName: { en: 'Amber Atelier', ar: 'أمبر أتيليه' },
    modes: ['shop'],
    owner: 'customer.hybrid',
    staff: [],
    onboarding: {
      status: 'draft',
      legalName: '',
      licenseNumber: '',
      emirate: 'SHJ',
      area: '',
      storefront: { name: { en: '', ar: '' }, description: { en: '', ar: '' } },
      colors: { from: [0, 0, 0], to: [0, 0, 0], disc: [0, 0, 0] },
    },
  },
];

/** Subcategories added locally on top of the MVP tree in migration 0003. */
export const SEED_SUBCATEGORIES: {
  mode: 'shop' | 'services';
  parent: string;
  slug: string;
  name: Localized;
}[] = [
  { mode: 'shop', parent: 'makeup', slug: 'lips', name: { en: 'Lips', ar: 'الشفاه' } },
  { mode: 'shop', parent: 'makeup', slug: 'face', name: { en: 'Face', ar: 'الوجه' } },
  { mode: 'shop', parent: 'makeup', slug: 'eyes', name: { en: 'Eyes', ar: 'العيون' } },
  {
    mode: 'shop',
    parent: 'skincare',
    slug: 'cleansers',
    name: { en: 'Cleansers', ar: 'المنظفات' },
  },
  {
    mode: 'shop',
    parent: 'skincare',
    slug: 'moisturisers',
    name: { en: 'Moisturisers', ar: 'المرطبات' },
  },
  {
    mode: 'shop',
    parent: 'skincare',
    slug: 'sun-care',
    name: { en: 'Sun care', ar: 'الحماية من الشمس' },
  },
  { mode: 'shop', parent: 'fragrance', slug: 'oud', name: { en: 'Oud', ar: 'العود' } },
  {
    mode: 'services',
    parent: 'hair',
    slug: 'cut-style',
    name: { en: 'Cut & style', ar: 'قص وتصفيف' },
  },
  { mode: 'services', parent: 'hair', slug: 'colour', name: { en: 'Colour', ar: 'صبغ' } },
  { mode: 'services', parent: 'nails', slug: 'manicure', name: { en: 'Manicure', ar: 'مانيكير' } },
  { mode: 'services', parent: 'nails', slug: 'pedicure', name: { en: 'Pedicure', ar: 'باديكير' } },
  { mode: 'services', parent: 'spa', slug: 'massage', name: { en: 'Massage', ar: 'تدليك' } },
];

/** Fictional brands (names invented for local data). */
export const SEED_BRANDS: { slug: string; name: Localized }[] = [
  { slug: 'desert-petal', name: { en: 'Desert Petal', ar: 'بتلة الصحراء' } },
  { slug: 'gulf-glow', name: { en: 'Gulf Glow', ar: 'توهج الخليج' } },
  { slug: 'oasis-lab', name: { en: 'Oasis Lab', ar: 'مختبر الواحة' } },
];

/** One admin per platform role (docs/04-admin.md). */
export const SEED_ADMIN_ROLES = [
  'superadmin',
  'compliance',
  'catalog',
  'operations',
  'finance',
  'support',
  'analyst',
] as const;
export const seedAdminEmail = (role: string) => `${role}@admin.example.test`;

// ---------------------------------------------------------------------------------------------
// Phase 3: products, stock and delivery zones. Fictional products and brands only.

export interface SeedProduct {
  business: string;
  category: string;
  brand: string | null;
  status: 'active' | 'submitted' | 'draft';
  title: Localized;
  description: Localized;
  details: Localized | null;
  colors: { from: [number, number, number]; to: [number, number, number] };
  variants: {
    sku: string;
    name: Localized;
    priceFils: number;
    stock: number;
    taxClass?: 'standard' | 'zero_rated' | 'exempt';
  }[];
}

export const SEED_DELIVERY_ZONES: Record<
  string,
  {
    emirate: string;
    feeFils: number;
    freeOverFils: number | null;
    minDays: number;
    maxDays: number;
  }[]
> = {
  noor: [
    { emirate: 'DXB', feeFils: 1_500, freeOverFils: 20_000, minDays: 1, maxDays: 2 },
    { emirate: 'SHJ', feeFils: 2_000, freeOverFils: 25_000, minDays: 1, maxDays: 3 },
    { emirate: 'AUH', feeFils: 2_500, freeOverFils: null, minDays: 2, maxDays: 4 },
  ],
  oud: [
    { emirate: 'DXB', feeFils: 2_000, freeOverFils: null, minDays: 1, maxDays: 3 },
    { emirate: 'AUH', feeFils: 2_000, freeOverFils: null, minDays: 1, maxDays: 3 },
  ],
};

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    business: 'noor',
    category: 'moisturisers',
    brand: 'gulf-glow',
    status: 'active',
    title: { en: 'Dew Drop Daily Moisturiser', ar: 'مرطب يومي قطرة الندى' },
    description: {
      en: 'A light gel cream for everyday hydration. Fictional product for local testing.',
      ar: 'كريم جل خفيف للترطيب اليومي. منتج تجريبي للاختبار المحلي.',
    },
    details: {
      en: 'Water, glycerin, aloe (fictional list).',
      ar: 'ماء، جلسرين، صبار (قائمة تجريبية).',
    },
    colors: { from: [196, 226, 232], to: [122, 170, 190] },
    variants: [
      { sku: 'NOOR-DEW-50', name: { en: '50 ml', ar: '٥٠ مل' }, priceFils: 8_900, stock: 24 },
      { sku: 'NOOR-DEW-100', name: { en: '100 ml', ar: '١٠٠ مل' }, priceFils: 14_500, stock: 3 },
    ],
  },
  {
    business: 'noor',
    category: 'lips',
    brand: 'desert-petal',
    status: 'active',
    title: { en: 'Velvet Dune Lip Colour', ar: 'أحمر شفاه كثبان مخملي' },
    description: {
      en: 'Soft matte lip colour in warm desert shades. Fictional product.',
      ar: 'أحمر شفاه مطفي ناعم بألوان الصحراء الدافئة. منتج تجريبي.',
    },
    details: null,
    colors: { from: [184, 92, 92], to: [122, 52, 70] },
    variants: [
      {
        sku: 'NOOR-VEL-ROSE',
        name: { en: 'Rose sand', ar: 'رمل وردي' },
        priceFils: 6_500,
        stock: 12,
      },
      {
        sku: 'NOOR-VEL-CLAY',
        name: { en: 'Red clay', ar: 'طين أحمر' },
        priceFils: 6_500,
        stock: 1,
      },
      { sku: 'NOOR-VEL-DUSK', name: { en: 'Dusk', ar: 'غسق' }, priceFils: 6_500, stock: 0 },
    ],
  },
  {
    business: 'noor',
    category: 'sun-care',
    brand: 'oasis-lab',
    status: 'active',
    title: { en: 'Shade Shield SPF 50 Fluid', ar: 'سائل واقي الظل بعامل ٥٠' },
    description: {
      en: 'Daily sun fluid with a sheer finish. Fictional product for local testing.',
      ar: 'سائل يومي للحماية من الشمس بلمسة شفافة. منتج تجريبي للاختبار المحلي.',
    },
    details: null,
    colors: { from: [252, 214, 140], to: [236, 150, 80] },
    variants: [
      { sku: 'NOOR-SHADE-40', name: { en: '40 ml', ar: '٤٠ مل' }, priceFils: 11_000, stock: 0 },
    ],
  },
  {
    business: 'noor',
    category: 'cleansers',
    brand: 'oasis-lab',
    status: 'submitted',
    title: { en: 'Clear Spring Gel Cleanser', ar: 'غسول جل الينبوع الصافي' },
    description: {
      en: 'Gentle foaming cleanser waiting for listing review. Fictional product.',
      ar: 'غسول رغوي لطيف بانتظار مراجعة الإدراج. منتج تجريبي.',
    },
    details: null,
    colors: { from: [210, 236, 220], to: [120, 180, 150] },
    variants: [
      { sku: 'NOOR-CLEAR-150', name: { en: '150 ml', ar: '١٥٠ مل' }, priceFils: 5_900, stock: 30 },
    ],
  },
  {
    business: 'noor',
    category: 'face',
    brand: null,
    status: 'draft',
    title: { en: 'Glow Veil Highlighter', ar: 'هايلايتر وشاح التوهج' },
    description: {
      en: 'Draft listing to try editing and submitting. Fictional product.',
      ar: 'إدراج في المسودة لتجربة التعديل والإرسال. منتج تجريبي.',
    },
    details: null,
    colors: { from: [246, 226, 200], to: [214, 176, 140] },
    variants: [
      { sku: 'NOOR-GLOW-01', name: { en: 'Champagne', ar: 'شمبانيا' }, priceFils: 7_500, stock: 0 },
    ],
  },
  {
    business: 'oud',
    category: 'oud',
    brand: null,
    status: 'active',
    title: { en: 'Amber Night Oud Oil', ar: 'زيت عود ليلة العنبر' },
    description: {
      en: 'Concentrated oud oil blended in-house. Fictional product for local testing.',
      ar: 'زيت عود مركز ممزوج في متجرنا. منتج تجريبي للاختبار المحلي.',
    },
    details: { en: 'Oud, amber, sandalwood (fictional).', ar: 'عود، عنبر، صندل (تجريبي).' },
    colors: { from: [92, 58, 40], to: [180, 120, 60] },
    variants: [
      { sku: 'OUD-AMBER-3', name: { en: '3 ml', ar: '٣ مل' }, priceFils: 18_000, stock: 6 },
      { sku: 'OUD-AMBER-12', name: { en: '12 ml', ar: '١٢ مل' }, priceFils: 59_000, stock: 2 },
    ],
  },
  {
    business: 'oud',
    category: 'bath-body',
    brand: 'desert-petal',
    status: 'active',
    title: { en: 'Rose Bloom Body Mist', ar: 'رذاذ الجسم زهرة الورد' },
    description: {
      en: 'Light rose body mist. Fictional product for local testing.',
      ar: 'رذاذ ورد خفيف للجسم. منتج تجريبي للاختبار المحلي.',
    },
    details: null,
    colors: { from: [240, 190, 200], to: [200, 120, 150] },
    variants: [
      { sku: 'OUD-ROSE-100', name: { en: '100 ml', ar: '١٠٠ مل' }, priceFils: 9_500, stock: 15 },
    ],
  },
];

/** A default delivery address for the seeded English customer (fictional). */
export const SEED_CUSTOMER_ADDRESS = {
  user: 'customer.en',
  label: 'Home',
  emirate: 'DXB',
  area: 'Jumeirah Lake Towers',
  street: 'Cluster Z (fictional)',
  building: 'Tower 9',
  unit: '1204',
};

/** Phase 4: branches, services, staff and weekly shifts for the services businesses. */
export interface SeedVenue {
  business: string;
  branch: {
    name: Localized;
    emirate: string;
    area: string;
    street: string;
    building: string;
    /** Weekday (0 = Sunday) to [opens, closes], local time. */
    hours: Record<number, [string, string]>;
  };
  services: {
    key: string;
    category: string;
    title: Localized;
    description: Localized;
    priceFils: number;
    durationMin: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    cancelCutoffHours: number;
    lateCancelRefundBps: number;
  }[];
  staff: {
    name: string;
    /** A member of the business whose account this profile belongs to. */
    member?: string;
    services: string[];
    shifts: Record<number, [string, string]>;
  }[];
}

const every = (from: string, to: string, days = [0, 1, 2, 3, 4, 5, 6]) =>
  Object.fromEntries(days.map((d) => [d, [from, to]])) as Record<number, [string, string]>;

export const SEED_VENUES: SeedVenue[] = [
  {
    business: 'lumiere',
    branch: {
      name: { en: 'Jumeirah', ar: 'جميرا' },
      emirate: 'DXB',
      area: 'Jumeirah 1',
      street: 'Beach Road (fictional)',
      building: 'Villa 12',
      hours: { ...every('10:00', '21:00', [0, 1, 2, 3, 4, 6]), 5: ['14:00', '22:00'] },
    },
    services: [
      {
        key: 'cut',
        category: 'hair',
        title: { en: 'Haircut and blow-dry', ar: 'قص وتجفيف الشعر' },
        description: {
          en: 'A consultation, wash, precision cut and blow-dry finish.',
          ar: 'استشارة وغسيل وقص دقيق مع تجفيف وتصفيف.',
        },
        priceFils: 15_000,
        durationMin: 60,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
        cancelCutoffHours: 24,
        lateCancelRefundBps: 5_000,
      },
      {
        key: 'gel',
        category: 'nails',
        title: { en: 'Gel manicure', ar: 'مانيكير جل' },
        description: {
          en: 'Shaping, cuticle care and a long-lasting gel colour of your choice.',
          ar: 'تشكيل الأظافر والعناية بالجلد ولون جل يدوم طويلًا من اختيارك.',
        },
        priceFils: 12_000,
        durationMin: 45,
        bufferBeforeMin: 0,
        bufferAfterMin: 10,
        cancelCutoffHours: 12,
        lateCancelRefundBps: 0,
      },
      {
        key: 'brows',
        category: 'brows-lashes',
        title: { en: 'Brow shaping', ar: 'تشكيل الحواجب' },
        description: {
          en: 'Threading and tidy-up to frame your face, with a soothing finish.',
          ar: 'تشكيل بالخيط وتهذيب لإبراز ملامح الوجه مع لمسة مهدئة.',
        },
        priceFils: 6_000,
        durationMin: 20,
        bufferBeforeMin: 0,
        bufferAfterMin: 5,
        cancelCutoffHours: 6,
        lateCancelRefundBps: 0,
      },
    ],
    staff: [
      {
        name: 'Sara',
        member: 'staff.pro',
        services: ['cut', 'brows'],
        shifts: every('10:00', '18:00', [0, 1, 2, 3, 6]),
      },
      {
        name: 'Mariam',
        services: ['gel', 'brows'],
        shifts: { ...every('12:00', '21:00', [1, 2, 3, 4]), 5: ['14:00', '22:00'] },
      },
      {
        name: 'Joy',
        services: ['cut', 'gel'],
        shifts: { ...every('10:00', '19:00', [0, 1, 2, 3, 6]), 5: ['14:00', '21:00'] },
      },
    ],
  },
  {
    business: 'oud',
    branch: {
      name: { en: 'Al Khalidiyah spa', ar: 'سبا الخالدية' },
      emirate: 'AUH',
      area: 'Al Khalidiyah',
      street: 'Corniche Road (fictional)',
      building: 'Bloom Tower, ground floor',
      hours: every('10:00', '22:00'),
    },
    services: [
      {
        key: 'massage',
        category: 'spa',
        title: { en: 'Signature oud massage', ar: 'مساج العود المميز' },
        description: {
          en: 'A full-body relaxing massage with warm oud-infused oil.',
          ar: 'مساج مريح لكامل الجسم بزيت دافئ معطر بالعود.',
        },
        priceFils: 35_000,
        durationMin: 60,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
        cancelCutoffHours: 24,
        lateCancelRefundBps: 5_000,
      },
      {
        key: 'hammam',
        category: 'spa',
        title: { en: 'Moroccan hammam ritual', ar: 'طقوس الحمام المغربي' },
        description: {
          en: 'Steam, black soap, a full scrub and a hydrating rose wrap.',
          ar: 'بخار وصابون أسود وتقشير كامل ولفافة ورد مرطبة.',
        },
        priceFils: 28_000,
        durationMin: 90,
        bufferBeforeMin: 10,
        bufferAfterMin: 20,
        cancelCutoffHours: 24,
        lateCancelRefundBps: 2_500,
      },
    ],
    staff: [
      { name: 'Leila', services: ['massage', 'hammam'], shifts: every('10:00', '18:00') },
      { name: 'Hana', services: ['massage', 'hammam'], shifts: every('14:00', '22:00') },
    ],
  },
];

/** Local-only placeholder commission (ADR-0015, D2). Real rates are a founder decision. */
export const SEED_FEE_RULES: { mode: 'shop' | 'services'; commissionBps: number }[] = [
  { mode: 'shop', commissionBps: 1_000 },
  { mode: 'services', commissionBps: 1_000 },
];
