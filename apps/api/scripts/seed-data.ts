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

export interface SeedBusiness {
  key: string;
  displayName: { en: string; ar: string };
  modes: ('shop' | 'services')[];
  owner: string;
  staff: { user: string; permissions: string[] }[];
}

/** Two product sellers, one salon and one hybrid (docs/10-build-plan.md). All in draft/onboarding. */
export const SEED_BUSINESSES: SeedBusiness[] = [
  {
    key: 'noor',
    displayName: { en: 'Noor Beauty Supply', ar: 'نور لمستلزمات التجميل' },
    modes: ['shop'],
    owner: 'owner.noor',
    staff: [],
  },
  {
    key: 'saffron',
    displayName: { en: 'Saffron Skin Co.', ar: 'زعفران للعناية بالبشرة' },
    modes: ['shop'],
    owner: 'owner.saffron',
    staff: [],
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
  },
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
