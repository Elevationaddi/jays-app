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
