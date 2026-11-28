/**
 * Staging demonstration dataset (docs/DEMO_DATA.md, ADR-0038). Every business, person, product,
 * review and message here is FICTIONAL. Names were invented for this file; any resemblance to a
 * real business is unintended. Emails use the reserved `.example` top-level domain, so no message
 * can ever reach a real inbox. All of it is marked as demonstration data in the database.
 */
export type Localized = { en: string; ar: string };
export type Emirate = 'AUH' | 'DXB' | 'SHJ' | 'AJM' | 'RAK' | 'FUJ' | 'UAQ';

export const DEMO_EMAIL_DOMAIN = 'demo.jays.example';
export const demoEmail = (local: string) => `${local}@${DEMO_EMAIL_DOMAIN}`;
/** Prefix on every demo storefront description, so the data can never pass as real activity. */
export const DEMO_LABEL: Localized = {
  en: 'Demo business (fictional). ',
  ar: 'نشاط تجريبي (وهمي). ',
};

export interface DemoVariant {
  name: Localized;
  priceFils: number;
  compareAtFils?: number;
  stock: number;
}
export interface DemoProduct {
  title: Localized;
  description: Localized;
  variants: DemoVariant[];
  returnEligible?: boolean;
}
export interface DemoService {
  category: string;
  title: Localized;
  description: Localized;
  priceFils: number;
  durationMin: number;
  bufferAfterMin?: number;
  cancelCutoffHours?: number;
  lateCancelRefundBps?: number;
  home?: boolean;
  addons?: { name: Localized; priceFils: number; durationMin: number }[];
}
export interface DemoBusiness {
  key: string;
  name: Localized;
  tagline: Localized;
  ownerName: string;
  emirate: Emirate;
  area: string;
  colors: { from: [number, number, number]; to: [number, number, number] };
  shop?: { category: string; products: DemoProduct[] };
  services?: {
    branches: { name: Localized; emirate: Emirate; area: string; open: string; close: string }[];
    staff: { name: string; title: string }[];
    services: DemoService[];
    home?: { areas: { emirate: Emirate; area: string | null; travelFeeFils: number }[] };
  };
}

const v = (
  en: string,
  ar: string,
  priceAed: number,
  stock: number,
  wasAed?: number,
): DemoVariant => ({
  name: { en, ar },
  priceFils: Math.round(priceAed * 100),
  ...(wasAed ? { compareAtFils: Math.round(wasAed * 100) } : {}),
  stock,
});
const p = (
  en: string,
  ar: string,
  descEn: string,
  descAr: string,
  variants: DemoVariant[],
  returnEligible = true,
): DemoProduct => ({
  title: { en, ar },
  description: { en: descEn, ar: descAr },
  variants,
  returnEligible,
});
const s = (
  category: string,
  en: string,
  ar: string,
  priceAed: number,
  durationMin: number,
  extra: Partial<DemoService> = {},
): DemoService => ({
  category,
  title: { en, ar },
  description: {
    en: `${en}. A fictional demonstration service with a clear price and duration.`,
    ar: `${ar}. خدمة تجريبية وهمية بسعر ومدة واضحين.`,
  },
  priceFils: Math.round(priceAed * 100),
  durationMin,
  bufferAfterMin: 10,
  ...extra,
});

// ---------------------------------------------------------------------------------------------
// Product businesses (makeup, skincare, perfumes, haircare, clothing, footwear, jewelry,
// accessories, lifestyle)

export const DEMO_BUSINESSES: DemoBusiness[] = [
  {
    key: 'velvet-hue',
    name: { en: 'Velvet Hue Cosmetics', ar: 'فلفت هيو لمستحضرات التجميل' },
    tagline: { en: 'Everyday colour, long-wear formulas.', ar: 'ألوان يومية بتركيبات تدوم طويلاً.' },
    ownerName: 'Dana Qasim',
    emirate: 'AUH',
    area: 'Al Reem Island',
    colors: { from: [176, 74, 110], to: [236, 170, 190] },
    shop: {
      category: 'makeup',
      products: [
        p(
          'Satin Lip Colour',
          'أحمر شفاه ساتان',
          'Creamy satin lipstick with a comfortable, lightweight feel.',
          'أحمر شفاه كريمي بلمسة ساتان خفيفة ومريحة.',
          [
            v('Rose Dune', 'وردي رملي', 69, 40),
            v('Brick Red', 'أحمر قرميدي', 69, 3),
            v('Mauve Mist', 'موف ضبابي', 69, 0),
          ],
        ),
        p(
          'Soft Matte Foundation',
          'كريم أساس مطفي ناعم',
          'Buildable medium coverage with a natural soft-matte finish.',
          'تغطية متوسطة قابلة للبناء بلمسة نهائية مطفية طبيعية.',
          [
            v('Light 110', 'فاتح 110', 145, 25, 179),
            v('Medium 220', 'متوسط 220', 145, 18, 179),
            v('Deep 330', 'داكن 330', 145, 9, 179),
          ],
        ),
        p(
          'Volume Mascara',
          'ماسكارا للكثافة',
          'Lifts and separates lashes without clumping.',
          'ترفع الرموش وتفصلها دون تكتل.',
          [v('Black', 'أسود', 85, 60)],
        ),
        p(
          'Desert Glow Palette',
          'باليت توهج الصحراء',
          'Nine warm eyeshadow shades in matte and shimmer.',
          'تسع درجات دافئة من ظلال العيون بين المطفي واللامع.',
          [v('Standard', 'قياسي', 189, 12, 220)],
        ),
        p(
          'Brow Sculpt Pencil',
          'قلم تحديد الحواجب',
          'Fine-tip pencil with a spoolie brush.',
          'قلم برأس رفيع مع فرشاة تمشيط.',
          [v('Taupe', 'رمادي بني', 55, 33), v('Espresso', 'إسبريسو', 55, 4)],
        ),
        p(
          'Setting Spray',
          'بخاخ تثبيت المكياج',
          'Keeps makeup in place through long, warm days.',
          'يثبت المكياج طوال الأيام الطويلة والحارة.',
          [v('100 ml', '100 مل', 99, 22)],
        ),
        p(
          'Cream Blush Stick',
          'أحمر خدود كريمي',
          'Sheer, blendable colour for cheeks and lips.',
          'لون شفاف سهل الدمج للخدود والشفاه.',
          [v('Peach', 'خوخي', 79, 15), v('Berry', 'توتي', 79, 15)],
        ),
      ],
    },
  },
  {
    key: 'lumen-pigment',
    name: { en: 'Lumen Pigment Studio', ar: 'استوديو لومن للألوان' },
    tagline: {
      en: 'Professional makeup for artists and beginners.',
      ar: 'مكياج احترافي للفنانين والمبتدئين.',
    },
    ownerName: 'Yara Mansour',
    emirate: 'DXB',
    area: 'Al Barsha',
    colors: { from: [60, 40, 90], to: [190, 150, 220] },
    shop: {
      category: 'makeup',
      products: [
        p(
          'Pro Concealer',
          'كونسيلر احترافي',
          'High-coverage concealer for spots and under-eye areas.',
          'كونسيلر عالي التغطية للبقع ومنطقة تحت العين.',
          [v('Fair', 'فاتح جداً', 95, 30), v('Tan', 'حنطي', 95, 2)],
        ),
        p(
          'Loose Setting Powder',
          'بودرة تثبيت سائبة',
          'Finely milled translucent powder.',
          'بودرة شفافة ناعمة جداً.',
          [v('Translucent', 'شفاف', 120, 20)],
        ),
        p(
          'Liquid Eyeliner',
          'آيلاينر سائل',
          'Precise felt tip, smudge-resistant.',
          'رأس دقيق مقاوم للتلطخ.',
          [v('Jet Black', 'أسود فاحم', 65, 45)],
        ),
        p(
          'Highlighter Duo',
          'ثنائي الإضاءة',
          'Two pressed highlighters, champagne and rose gold.',
          'إضاءتان مضغوطتان بلون الشمبانيا والذهبي الوردي.',
          [v('Standard', 'قياسي', 110, 0)],
        ),
        p(
          'Brush Set (8 pieces)',
          'مجموعة فرش (8 قطع)',
          'Synthetic brushes for face and eyes, with a pouch.',
          'فرش صناعية للوجه والعينين مع حقيبة.',
          [v('Standard', 'قياسي', 230, 8, 280)],
        ),
        p(
          'Lip Liner',
          'محدد شفاه',
          'Creamy liner that stops colour from feathering.',
          'محدد كريمي يمنع انتشار اللون.',
          [v('Nude', 'نود', 45, 50), v('Plum', 'برقوقي', 45, 12)],
        ),
      ],
    },
  },
  {
    key: 'oasis-skin',
    name: { en: 'Oasis Skin Lab', ar: 'مختبر واحة للبشرة' },
    tagline: { en: 'Gentle skincare for hot climates.', ar: 'عناية لطيفة بالبشرة للأجواء الحارة.' },
    ownerName: 'Mariam Haddad',
    emirate: 'AUH',
    area: 'Khalifa City',
    colors: { from: [64, 140, 130], to: [190, 230, 215] },
    shop: {
      category: 'skincare',
      products: [
        p(
          'Hydrating Gel Cleanser',
          'غسول جل مرطب',
          'Removes sunscreen and makeup without tightness.',
          'يزيل واقي الشمس والمكياج دون شد البشرة.',
          [v('150 ml', '150 مل', 89, 40), v('300 ml', '300 مل', 149, 12)],
        ),
        p(
          'Niacinamide Serum',
          'سيروم النياسيناميد',
          'Lightweight serum for an even-looking tone.',
          'سيروم خفيف لبشرة بمظهر متجانس.',
          [v('30 ml', '30 مل', 129, 25, 159)],
        ),
        p(
          'Daily Mineral Sunscreen SPF 50',
          'واقي شمس معدني يومي SPF 50',
          'Broad-spectrum protection with no white cast.',
          'حماية واسعة الطيف دون أثر أبيض.',
          [v('50 ml', '50 مل', 115, 6)],
        ),
        p(
          'Barrier Repair Cream',
          'كريم إصلاح الحاجز',
          'Rich moisturiser with ceramides.',
          'مرطب غني بالسيراميد.',
          [v('50 ml', '50 مل', 139, 18)],
        ),
        p(
          'Clay Purifying Mask',
          'قناع الطين المنقي',
          'Weekly mask for oily and combination skin.',
          'قناع أسبوعي للبشرة الدهنية والمختلطة.',
          [v('75 ml', '75 مل', 99, 0)],
        ),
        p(
          'Soothing Toner',
          'تونر مهدئ',
          'Alcohol-free toner with aloe and panthenol.',
          'تونر خالٍ من الكحول بالصبار والبانثينول.',
          [v('200 ml', '200 مل', 79, 35)],
        ),
        p(
          'Eye Contour Cream',
          'كريم محيط العين',
          'Light cream for the delicate eye area.',
          'كريم خفيف لمنطقة العين الحساسة.',
          [v('15 ml', '15 مل', 119, 14)],
        ),
      ],
    },
  },
  {
    key: 'pearl-dew',
    name: { en: 'Pearl & Dew Botanicals', ar: 'بيرل آند ديو للنباتات' },
    tagline: { en: 'Plant-based skin and body care.', ar: 'عناية نباتية بالبشرة والجسم.' },
    ownerName: 'Salma Rahimi',
    emirate: 'SHJ',
    area: 'Al Majaz',
    colors: { from: [210, 190, 150], to: [250, 240, 220] },
    shop: {
      category: 'skincare',
      products: [
        p(
          'Rosehip Face Oil',
          'زيت ثمر الورد للوجه',
          'Cold-pressed oil for dry skin.',
          'زيت معصور على البارد للبشرة الجافة.',
          [v('30 ml', '30 مل', 105, 20)],
        ),
        p(
          'Oat Milk Cleansing Balm',
          'بلسم تنظيف بحليب الشوفان',
          'Melts away makeup and rinses clean.',
          'يذيب المكياج ويُشطف بسهولة.',
          [v('100 g', '100 غ', 95, 16, 115)],
        ),
        p(
          'Vitamin C Brightening Serum',
          'سيروم فيتامين سي للإشراق',
          'Stable vitamin C for a brighter-looking complexion.',
          'فيتامين سي ثابت لبشرة أكثر إشراقاً.',
          [v('30 ml', '30 مل', 165, 9)],
        ),
        p(
          'Shea Body Butter',
          'زبدة الشيا للجسم',
          'Whipped body butter with a light citrus scent.',
          'زبدة جسم مخفوقة برائحة حمضيات خفيفة.',
          [v('200 ml', '200 مل', 85, 30)],
        ),
        p(
          'Lip Treatment Balm',
          'بلسم علاج الشفاه',
          'Overnight lip balm with honey.',
          'بلسم ليلي للشفاه بالعسل.',
          [v('15 g', '15 غ', 49, 55)],
        ),
        p(
          'Gentle Exfoliating Powder',
          'بودرة تقشير لطيفة',
          'Rice and enzyme powder that activates with water.',
          'بودرة الأرز والإنزيمات تتفاعل مع الماء.',
          [v('60 g', '60 غ', 89, 1)],
        ),
      ],
    },
  },
  {
    key: 'amber-dunes',
    name: { en: 'Amber Dunes Perfumery', ar: 'عطور كثبان العنبر' },
    tagline: {
      en: 'Oud, amber and modern Arabian blends.',
      ar: 'العود والعنبر وتركيبات عربية عصرية.',
    },
    ownerName: 'Faisal Al Amiri',
    emirate: 'AUH',
    area: 'Al Khalidiyah',
    colors: { from: [120, 70, 30], to: [230, 180, 110] },
    shop: {
      category: 'fragrance',
      products: [
        p(
          'Royal Oud Eau de Parfum',
          'عطر العود الملكي',
          'Deep oud with rose and saffron.',
          'عود عميق مع الورد والزعفران.',
          [v('50 ml', '50 مل', 320, 14, 380), v('100 ml', '100 مل', 520, 6, 610)],
          false,
        ),
        p(
          'Amber Night',
          'ليلة العنبر',
          'Warm amber, vanilla and tonka.',
          'عنبر دافئ مع الفانيليا والتونكا.',
          [v('100 ml', '100 مل', 410, 9)],
          false,
        ),
        p(
          'White Musk Mist',
          'رذاذ المسك الأبيض',
          'Soft musk body mist for every day.',
          'رذاذ مسك ناعم للجسم للاستخدام اليومي.',
          [v('150 ml', '150 مل', 95, 40)],
          false,
        ),
        p(
          'Bakhoor Blocks',
          'بخور معمول',
          'Hand-mixed bakhoor with sandalwood.',
          'بخور ممزوج يدوياً بخشب الصندل.',
          [v('40 g', '40 غ', 75, 50), v('100 g', '100 غ', 160, 2)],
          false,
        ),
        p(
          'Rose Taifi Attar',
          'دهن الورد الطائفي',
          'Concentrated rose oil, alcohol free.',
          'زيت ورد مركز خالٍ من الكحول.',
          [v('12 ml', '12 مل', 260, 7)],
          false,
        ),
        p(
          'Discovery Set',
          'مجموعة الاكتشاف',
          'Five 5 ml samples of the house collection.',
          'خمس عينات بحجم 5 مل من مجموعة الدار.',
          [v('5 x 5 ml', '5 × 5 مل', 150, 20)],
          false,
        ),
        p(
          'Citrus Neroli Cologne',
          'كولونيا الحمضيات والنيرولي',
          'Fresh and bright for warm days.',
          'منعشة ومشرقة للأيام الحارة.',
          [v('100 ml', '100 مل', 280, 0)],
          false,
        ),
      ],
    },
  },
  {
    key: 'silk-strand',
    name: { en: 'Silk Strand Haircare', ar: 'سيلك ستراند للعناية بالشعر' },
    tagline: {
      en: 'Haircare for curls, colour and heat.',
      ar: 'عناية بالشعر المجعد والمصبوغ والمعرض للحرارة.',
    },
    ownerName: 'Nadia Karam',
    emirate: 'DXB',
    area: 'Jumeirah Lake Towers',
    colors: { from: [90, 60, 40], to: [220, 190, 160] },
    shop: {
      category: 'haircare',
      products: [
        p(
          'Argan Repair Shampoo',
          'شامبو الأرغان للإصلاح',
          'Sulphate-free shampoo for dry hair.',
          'شامبو خالٍ من الكبريتات للشعر الجاف.',
          [v('300 ml', '300 مل', 79, 45), v('1 L', '1 لتر', 189, 10)],
        ),
        p(
          'Deep Conditioning Mask',
          'ماسك ترطيب عميق',
          'Weekly mask with keratin.',
          'ماسك أسبوعي بالكيراتين.',
          [v('250 ml', '250 مل', 99, 22, 125)],
        ),
        p(
          'Heat Protect Spray',
          'بخاخ حماية من الحرارة',
          'Protects up to 230 °C.',
          'يحمي حتى 230 درجة مئوية.',
          [v('200 ml', '200 مل', 69, 5)],
        ),
        p(
          'Curl Defining Cream',
          'كريم تحديد التموجات',
          'Defines curls without crunch.',
          'يحدد التموجات دون قساوة.',
          [v('200 ml', '200 مل', 85, 28)],
        ),
        p(
          'Scalp Serum',
          'سيروم فروة الرأس',
          'Lightweight serum for a comfortable scalp.',
          'سيروم خفيف لفروة رأس مريحة.',
          [v('50 ml', '50 مل', 135, 12)],
        ),
        p(
          'Wide-Tooth Comb',
          'مشط بأسنان عريضة',
          'Detangling comb made from plant-based resin.',
          'مشط لفك التشابك من راتنج نباتي.',
          [v('Standard', 'قياسي', 35, 70)],
        ),
      ],
    },
  },
  {
    key: 'noor-thread',
    name: { en: 'Noor Thread Boutique', ar: 'بوتيك نور ثريد' },
    tagline: { en: 'Modest fashion and everyday abayas.', ar: 'أزياء محتشمة وعبايات يومية.' },
    ownerName: 'Huda Salem',
    emirate: 'AUH',
    area: 'Al Bateen',
    colors: { from: [30, 30, 40], to: [140, 130, 150] },
    shop: {
      category: 'fashion',
      products: [
        p(
          'Classic Black Abaya',
          'عباية سوداء كلاسيكية',
          'Lightweight crepe abaya with a soft drape.',
          'عباية كريب خفيفة بانسدال ناعم.',
          [
            v('Size 52', 'مقاس 52', 450, 6),
            v('Size 54', 'مقاس 54', 450, 8),
            v('Size 56', 'مقاس 56', 450, 2),
            v('Size 58', 'مقاس 58', 450, 0),
          ],
        ),
        p(
          'Linen Kaftan',
          'قفطان كتان',
          'Breathable linen kaftan for summer.',
          'قفطان كتان مريح للصيف.',
          [v('S/M', 'صغير/متوسط', 320, 10, 390), v('L/XL', 'كبير/كبير جداً', 320, 7, 390)],
        ),
        p(
          'Chiffon Shayla',
          'شيلة شيفون',
          'Soft chiffon scarf in neutral tones.',
          'شيلة شيفون ناعمة بألوان محايدة.',
          [v('Sand', 'رملي', 65, 40), v('Olive', 'زيتوني', 65, 25), v('Black', 'أسود', 65, 50)],
        ),
        p(
          'Wide-Leg Trousers',
          'بنطال واسع',
          'High-waisted trousers in stretch crepe.',
          'بنطال بخصر عالٍ من الكريب المرن.',
          [v('S', 'صغير', 190, 9), v('M', 'متوسط', 190, 12), v('L', 'كبير', 190, 4)],
        ),
        p(
          'Embroidered Jalabiya',
          'جلابية مطرزة',
          'Hand-finished embroidery on cotton.',
          'تطريز بلمسات يدوية على القطن.',
          [v('One size', 'مقاس واحد', 380, 5)],
        ),
        p(
          'Knit Cardigan',
          'كارديجان محبوك',
          'Long, light knit for air-conditioned rooms.',
          'كارديجان طويل خفيف للأماكن المكيفة.',
          [v('One size', 'مقاس واحد', 210, 14)],
        ),
      ],
    },
  },
  {
    key: 'stride-co',
    name: { en: 'Stride & Co. Footwear', ar: 'سترايد آند كو للأحذية' },
    tagline: { en: 'Comfortable shoes for city days.', ar: 'أحذية مريحة لأيام المدينة.' },
    ownerName: 'Rami Shalabi',
    emirate: 'DXB',
    area: 'Business Bay',
    colors: { from: [70, 80, 100], to: [180, 190, 210] },
    shop: {
      category: 'footwear',
      products: [
        p(
          'Leather Ballet Flats',
          'حذاء باليه جلد',
          'Soft leather flats with a cushioned insole.',
          'حذاء جلد ناعم بنعل داخلي مبطن.',
          [
            v('EU 37', 'مقاس 37', 260, 5),
            v('EU 38', 'مقاس 38', 260, 7),
            v('EU 39', 'مقاس 39', 260, 1),
          ],
        ),
        p(
          'Everyday Sneakers',
          'حذاء رياضي يومي',
          'Breathable knit sneakers.',
          'حذاء رياضي محبوك جيد التهوية.',
          [
            v('EU 38', 'مقاس 38', 310, 9, 360),
            v('EU 40', 'مقاس 40', 310, 11, 360),
            v('EU 42', 'مقاس 42', 310, 6, 360),
          ],
        ),
        p(
          'Block Heel Sandals',
          'صندل بكعب عريض',
          'Stable 5 cm heel with ankle strap.',
          'كعب ثابت 5 سم مع سوار للكاحل.',
          [v('EU 37', 'مقاس 37', 285, 4), v('EU 39', 'مقاس 39', 285, 0)],
        ),
        p(
          'Men’s Leather Sandals',
          'صندل رجالي جلد',
          'Traditional style with a modern sole.',
          'تصميم تقليدي بنعل عصري.',
          [v('EU 42', 'مقاس 42', 240, 10), v('EU 44', 'مقاس 44', 240, 8)],
        ),
        p(
          'Suede Loafers',
          'حذاء لوفر شامواه',
          'Unlined suede loafers.',
          'حذاء لوفر شامواه دون بطانة.',
          [v('EU 41', 'مقاس 41', 340, 6)],
        ),
      ],
    },
  },
  {
    key: 'gilded-crescent',
    name: { en: 'Gilded Crescent Jewellery', ar: 'مجوهرات الهلال المذهب' },
    tagline: { en: 'Fine-look jewellery in plated silver.', ar: 'مجوهرات أنيقة من الفضة المطلية.' },
    ownerName: 'Leen Barakat',
    emirate: 'DXB',
    area: 'Downtown',
    colors: { from: [150, 120, 50], to: [240, 220, 160] },
    shop: {
      category: 'jewelry',
      products: [
        p(
          'Crescent Pendant Necklace',
          'قلادة الهلال',
          'Gold-plated sterling silver pendant on a 45 cm chain.',
          'قلادة من الفضة الإسترلينية المطلية بالذهب على سلسلة 45 سم.',
          [v('Gold plated', 'مطلية بالذهب', 245, 12, 295), v('Silver', 'فضة', 199, 15)],
          false,
        ),
        p(
          'Pearl Drop Earrings',
          'أقراط اللؤلؤ',
          'Freshwater pearl drops on silver hooks.',
          'أقراط لؤلؤ المياه العذبة على خطافات فضية.',
          [v('Standard', 'قياسي', 175, 9)],
          false,
        ),
        p(
          'Stacking Rings Set',
          'مجموعة خواتم',
          'Three thin rings to wear together.',
          'ثلاثة خواتم رفيعة تُلبس معاً.',
          [v('Size 6', 'مقاس 6', 155, 6), v('Size 7', 'مقاس 7', 155, 3)],
          false,
        ),
        p(
          'Engraved Name Bracelet',
          'سوار بالاسم',
          'Bar bracelet; personalised designs are made to order.',
          'سوار بلوحة؛ التصاميم المخصصة تُصنع حسب الطلب.',
          [v('Standard', 'قياسي', 210, 20)],
          false,
        ),
        p(
          'Hoop Earrings',
          'أقراط دائرية',
          'Lightweight 25 mm hoops.',
          'أقراط دائرية خفيفة 25 مم.',
          [v('Gold plated', 'مطلية بالذهب', 120, 0)],
          false,
        ),
      ],
    },
  },
  {
    key: 'dune-carry',
    name: { en: 'Dune Carry Accessories', ar: 'ديون كاري للإكسسوارات' },
    tagline: {
      en: 'Bags, scarves and small leather goods.',
      ar: 'حقائب وأوشحة ومنتجات جلدية صغيرة.',
    },
    ownerName: 'Tariq Hamdan',
    emirate: 'RAK',
    area: 'Al Nakheel',
    colors: { from: [140, 90, 60], to: [220, 180, 140] },
    shop: {
      category: 'accessories',
      products: [
        p(
          'Leather Tote Bag',
          'حقيبة توت جلد',
          'Roomy tote with an inner zip pocket.',
          'حقيبة واسعة بجيب داخلي بسحاب.',
          [v('Tan', 'بني فاتح', 420, 6, 495), v('Black', 'أسود', 420, 9, 495)],
        ),
        p(
          'Card Holder',
          'حافظة بطاقات',
          'Slim card holder with four slots.',
          'حافظة رفيعة بأربع خانات.',
          [v('Black', 'أسود', 95, 30)],
        ),
        p(
          'Silk Square Scarf',
          'وشاح حرير مربع',
          '90 cm printed silk scarf.',
          'وشاح حرير مطبوع بمقاس 90 سم.',
          [v('Desert print', 'نقشة الصحراء', 180, 11)],
        ),
        p(
          'Sunglasses',
          'نظارة شمسية',
          'Polarised lenses with UV400 protection.',
          'عدسات مستقطبة بحماية UV400.',
          [v('Tortoise', 'صدفي', 230, 8), v('Black', 'أسود', 230, 2)],
        ),
        p(
          'Travel Pouch Set',
          'مجموعة حقائب سفر',
          'Three zip pouches for toiletries and cables.',
          'ثلاث حقائب بسحاب لأدوات العناية والكابلات.',
          [v('Standard', 'قياسي', 120, 18)],
        ),
      ],
    },
  },
  {
    key: 'calm-corner',
    name: { en: 'Calm Corner Living', ar: 'كالم كورنر لايفنج' },
    tagline: {
      en: 'Candles, diffusers and self-care gifts.',
      ar: 'شموع وموزعات عطرية وهدايا للعناية الذاتية.',
    },
    ownerName: 'Aisha Morad',
    emirate: 'AJM',
    area: 'Al Nuaimiya',
    colors: { from: [110, 130, 100], to: [220, 230, 200] },
    shop: {
      category: 'lifestyle',
      products: [
        p(
          'Soy Candle',
          'شمعة صويا',
          'Hand-poured soy candle, 40 hours.',
          'شمعة صويا مصبوبة يدوياً تدوم 40 ساعة.',
          [v('Fig & Cedar', 'تين وأرز', 89, 25), v('Jasmine', 'ياسمين', 89, 20)],
        ),
        p(
          'Reed Diffuser',
          'موزع عطري بالأعواد',
          'Long-lasting fragrance for small rooms.',
          'عطر يدوم طويلاً للغرف الصغيرة.',
          [v('200 ml', '200 مل', 135, 12, 160)],
        ),
        p(
          'Self-Care Gift Box',
          'صندوق هدايا العناية الذاتية',
          'Candle, bath salts and a satin sleep mask.',
          'شمعة وأملاح استحمام وقناع نوم من الساتان.',
          [v('Standard', 'قياسي', 245, 7)],
        ),
        p(
          'Ceramic Incense Holder',
          'مبخرة خزفية',
          'Handmade ceramic holder.',
          'مبخرة خزفية مصنوعة يدوياً.',
          [v('White', 'أبيض', 75, 15)],
        ),
        p(
          'Linen Spray',
          'بخاخ للمفارش',
          'Light lavender spray for pillows and linen.',
          'بخاخ لافندر خفيف للوسائد والمفارش.',
          [v('100 ml', '100 مل', 55, 0)],
        ),
      ],
    },
  },
  {
    key: 'saffron-veil',
    name: { en: 'Saffron Veil Beauty', ar: 'سافرون فيل للجمال' },
    tagline: { en: 'Body care inspired by the region.', ar: 'عناية بالجسم مستوحاة من المنطقة.' },
    ownerName: 'Reem Al Suwaidi',
    emirate: 'FUJ',
    area: 'Fujairah City',
    colors: { from: [200, 120, 40], to: [250, 210, 150] },
    shop: {
      category: 'bath-body',
      products: [
        p(
          'Saffron Body Scrub',
          'مقشر الجسم بالزعفران',
          'Sugar scrub with saffron and date seed oil.',
          'مقشر سكري بالزعفران وزيت نوى التمر.',
          [v('250 g', '250 غ', 99, 20)],
        ),
        p(
          'Rose Water Mist',
          'رذاذ ماء الورد',
          'Refreshing mist for face and body.',
          'رذاذ منعش للوجه والجسم.',
          [v('120 ml', '120 مل', 49, 60)],
        ),
        p(
          'Henna Hand Cream',
          'كريم اليدين بالحناء',
          'Nourishing hand cream with a henna scent.',
          'كريم مغذٍ لليدين برائحة الحناء.',
          [v('75 ml', '75 مل', 45, 35, 55)],
        ),
        p(
          'Black Soap',
          'الصابون الأسود',
          'Traditional olive black soap for the hammam.',
          'صابون زيتون أسود تقليدي للحمام.',
          [v('200 g', '200 غ', 59, 4)],
        ),
        p(
          'Body Oil with Oud',
          'زيت الجسم بالعود',
          'Dry body oil with a soft oud scent.',
          'زيت جاف للجسم برائحة عود خفيفة.',
          [v('100 ml', '100 مل', 155, 10)],
        ),
      ],
    },
  },

  // -------------------------------------------------------------------------------------------
  // Service businesses (hair salons, nail salons, makeup artists, eyelashes, eyebrows, barbers,
  // non-medical spas, at-home beauty)

  {
    key: 'luma-hair',
    name: { en: 'Luma Hair Studio', ar: 'استوديو لوما للشعر' },
    tagline: { en: 'Cuts, colour and blow-dries.', ar: 'قص وصبغ وتصفيف الشعر.' },
    ownerName: 'Carla Mendes',
    emirate: 'AUH',
    area: 'Al Raha Beach',
    colors: { from: [150, 90, 120], to: [235, 200, 215] },
    services: {
      branches: [
        {
          name: { en: 'Al Raha Beach', ar: 'شاطئ الراحة' },
          emirate: 'AUH',
          area: 'Al Raha Beach',
          open: '09:00',
          close: '21:00',
        },
        {
          name: { en: 'Al Reem Island', ar: 'جزيرة الريم' },
          emirate: 'AUH',
          area: 'Al Reem Island',
          open: '10:00',
          close: '22:00',
        },
      ],
      staff: [
        { name: 'Sofia', title: 'Senior stylist' },
        { name: 'Lina', title: 'Colourist' },
        { name: 'Grace', title: 'Stylist' },
        { name: 'Hiba', title: 'Junior stylist' },
      ],
      services: [
        s('hair', 'Women’s haircut and blow-dry', 'قص وتجفيف شعر نسائي', 180, 60, {
          addons: [
            {
              name: { en: 'Deep conditioning', ar: 'ترطيب عميق' },
              priceFils: 6000,
              durationMin: 15,
            },
          ],
        }),
        s('hair', 'Blow-dry', 'تجفيف وتصفيف', 120, 45),
        s('hair', 'Root colour', 'صبغ الجذور', 260, 90, {
          cancelCutoffHours: 48,
          lateCancelRefundBps: 5000,
        }),
        s('hair', 'Full highlights', 'خصل كاملة', 650, 150, {
          cancelCutoffHours: 48,
          lateCancelRefundBps: 2500,
        }),
        s('hair', 'Keratin smoothing', 'تنعيم بالكيراتين', 900, 180, {
          cancelCutoffHours: 48,
          lateCancelRefundBps: 0,
        }),
        s('hair', 'Children’s haircut', 'قص شعر الأطفال', 80, 30),
      ],
    },
  },
  {
    key: 'polish-petal',
    name: { en: 'Polish & Petal Nail Bar', ar: 'بوليش آند بيتال لتجميل الأظافر' },
    tagline: { en: 'Manicures, pedicures and nail art.', ar: 'مانيكير وباديكير ورسم على الأظافر.' },
    ownerName: 'Joy Santos',
    emirate: 'DXB',
    area: 'Jumeirah',
    colors: { from: [200, 80, 110], to: [250, 200, 210] },
    services: {
      branches: [
        {
          name: { en: 'Jumeirah Beach Road', ar: 'شارع شاطئ جميرا' },
          emirate: 'DXB',
          area: 'Jumeirah',
          open: '09:00',
          close: '22:00',
        },
      ],
      staff: [
        { name: 'Mae', title: 'Nail technician' },
        { name: 'Rhea', title: 'Nail artist' },
        { name: 'Tala', title: 'Nail technician' },
      ],
      services: [
        s('nails', 'Classic manicure', 'مانيكير كلاسيكي', 90, 40),
        s('nails', 'Gel manicure', 'مانيكير جل', 150, 60, {
          addons: [
            {
              name: { en: 'Nail art (two nails)', ar: 'رسم على ظفرين' },
              priceFils: 3000,
              durationMin: 10,
            },
          ],
        }),
        s('nails', 'Spa pedicure', 'باديكير سبا', 160, 60),
        s('nails', 'Gel removal', 'إزالة الجل', 50, 20),
        s('nails', 'Acrylic extensions', 'تركيب أظافر أكريليك', 280, 90, {
          cancelCutoffHours: 24,
          lateCancelRefundBps: 5000,
        }),
      ],
    },
  },
  {
    key: 'glow-artistry',
    name: { en: 'Glow Artistry by Rana', ar: 'جلو آرتستري من رنا' },
    tagline: {
      en: 'Event and bridal makeup, at the studio or at home.',
      ar: 'مكياج المناسبات والعرائس في الاستوديو أو في المنزل.',
    },
    ownerName: 'Rana Khoury',
    emirate: 'AUH',
    area: 'Mohammed Bin Zayed City',
    colors: { from: [180, 110, 90], to: [245, 215, 200] },
    services: {
      branches: [
        {
          name: { en: 'MBZ City studio', ar: 'استوديو مدينة محمد بن زايد' },
          emirate: 'AUH',
          area: 'Mohammed Bin Zayed City',
          open: '08:00',
          close: '22:00',
        },
      ],
      staff: [
        { name: 'Rana', title: 'Lead makeup artist' },
        { name: 'Noura', title: 'Makeup artist' },
      ],
      services: [
        s('makeup', 'Soft glam makeup', 'مكياج ناعم', 450, 75, {
          home: true,
          cancelCutoffHours: 48,
          lateCancelRefundBps: 5000,
        }),
        s('makeup', 'Evening makeup with lashes', 'مكياج سهرة مع رموش', 550, 90, {
          home: true,
          cancelCutoffHours: 48,
          lateCancelRefundBps: 5000,
        }),
        s('makeup', 'Bridal trial', 'تجربة مكياج العروس', 700, 120, {
          cancelCutoffHours: 72,
          lateCancelRefundBps: 0,
        }),
        s('makeup', 'Makeup lesson', 'درس مكياج', 380, 90),
      ],
      home: {
        areas: [
          { emirate: 'AUH', area: null, travelFeeFils: 10000 },
          { emirate: 'AUH', area: 'Mohammed Bin Zayed City', travelFeeFils: 5000 },
        ],
      },
    },
  },
  {
    key: 'flutter-lash',
    name: { en: 'Flutter Lash Lounge', ar: 'فلاتر لاش لاونج' },
    tagline: { en: 'Lash extensions, lifts and tints.', ar: 'تركيب ورفع وصبغ الرموش.' },
    ownerName: 'Mira Tan',
    emirate: 'DXB',
    area: 'Dubai Marina',
    colors: { from: [40, 40, 60], to: [170, 160, 200] },
    services: {
      branches: [
        {
          name: { en: 'Dubai Marina', ar: 'دبي مارينا' },
          emirate: 'DXB',
          area: 'Dubai Marina',
          open: '10:00',
          close: '21:00',
        },
      ],
      staff: [
        { name: 'Kim', title: 'Lash artist' },
        { name: 'Ana', title: 'Lash artist' },
        { name: 'Dina', title: 'Lash and brow technician' },
      ],
      services: [
        s('brows-lashes', 'Classic lash extensions', 'رموش كلاسيكية', 300, 90, {
          cancelCutoffHours: 24,
          lateCancelRefundBps: 5000,
        }),
        s('brows-lashes', 'Volume lash extensions', 'رموش فوليوم', 420, 120, {
          cancelCutoffHours: 24,
          lateCancelRefundBps: 5000,
        }),
        s('brows-lashes', 'Lash refill (3 weeks)', 'تعبئة الرموش (3 أسابيع)', 200, 60),
        s('brows-lashes', 'Lash lift and tint', 'رفع وصبغ الرموش', 220, 60),
        s('brows-lashes', 'Lash removal', 'إزالة الرموش', 60, 20),
      ],
    },
  },
  {
    key: 'arch-brow',
    name: { en: 'Arch Brow Bar', ar: 'آرتش براو بار' },
    tagline: {
      en: 'Threading, shaping and brow lamination.',
      ar: 'الخيط وتشكيل الحواجب وتصفيفها.',
    },
    ownerName: 'Priya Nair',
    emirate: 'SHJ',
    area: 'Al Nahda',
    colors: { from: [110, 70, 50], to: [220, 190, 170] },
    services: {
      branches: [
        {
          name: { en: 'Al Nahda', ar: 'النهدة' },
          emirate: 'SHJ',
          area: 'Al Nahda',
          open: '10:00',
          close: '22:00',
        },
      ],
      staff: [
        { name: 'Meera', title: 'Brow specialist' },
        { name: 'Zainab', title: 'Threading specialist' },
      ],
      services: [
        s('brows-lashes', 'Brow threading', 'تشقير الحواجب بالخيط', 40, 15, { bufferAfterMin: 5 }),
        s('brows-lashes', 'Brow shaping and tint', 'تشكيل وصبغ الحواجب', 110, 40),
        s('brows-lashes', 'Brow lamination', 'تصفيف الحواجب', 220, 60),
        s('waxing', 'Upper lip wax', 'إزالة شعر الشفة العليا بالشمع', 30, 10, {
          bufferAfterMin: 5,
        }),
      ],
    },
  },
  {
    key: 'sharp-line',
    name: { en: 'Sharp Line Barbers', ar: 'شارب لاين للحلاقة' },
    tagline: {
      en: 'Fades, beard trims and hot towel shaves.',
      ar: 'قصات متدرجة وتهذيب اللحية وحلاقة بالمنشفة الساخنة.',
    },
    ownerName: 'Omar Haddad',
    emirate: 'AUH',
    area: 'Al Mushrif',
    colors: { from: [30, 50, 70], to: [130, 160, 190] },
    services: {
      branches: [
        {
          name: { en: 'Al Mushrif', ar: 'المشرف' },
          emirate: 'AUH',
          area: 'Al Mushrif',
          open: '09:00',
          close: '23:00',
        },
        {
          name: { en: 'Yas Island', ar: 'جزيرة ياس' },
          emirate: 'AUH',
          area: 'Yas Island',
          open: '10:00',
          close: '23:00',
        },
      ],
      staff: [
        { name: 'Yousef', title: 'Master barber' },
        { name: 'Ali', title: 'Barber' },
        { name: 'Karim', title: 'Barber' },
        { name: 'Sami', title: 'Junior barber' },
      ],
      services: [
        s('barbering', 'Haircut', 'قص الشعر', 70, 30),
        s('barbering', 'Skin fade', 'قصة متدرجة', 90, 40),
        s('barbering', 'Beard trim and shape', 'تهذيب وتشكيل اللحية', 50, 20),
        s('barbering', 'Hot towel shave', 'حلاقة بالمنشفة الساخنة', 80, 30),
        s('barbering', 'Haircut and beard package', 'باقة قص الشعر واللحية', 110, 50),
      ],
    },
  },
  {
    key: 'serene-sands',
    name: { en: 'Serene Sands Spa', ar: 'سبا الرمال الهادئة' },
    tagline: {
      en: 'Relaxing massages and hammam rituals (non-medical).',
      ar: 'جلسات تدليك واسترخاء وطقوس الحمام (غير طبية).',
    },
    ownerName: 'Laila Rostami',
    emirate: 'AUH',
    area: 'Saadiyat Island',
    colors: { from: [80, 110, 120], to: [200, 225, 225] },
    services: {
      branches: [
        {
          name: { en: 'Saadiyat Island', ar: 'جزيرة السعديات' },
          emirate: 'AUH',
          area: 'Saadiyat Island',
          open: '10:00',
          close: '22:00',
        },
      ],
      staff: [
        { name: 'Ploy', title: 'Spa therapist' },
        { name: 'Aiko', title: 'Spa therapist' },
        { name: 'Fatima', title: 'Hammam attendant' },
      ],
      services: [
        s('spa', 'Relaxing massage (60 min)', 'تدليك استرخائي (60 دقيقة)', 350, 60, {
          bufferAfterMin: 15,
          addons: [
            { name: { en: 'Hot stones', ar: 'الأحجار الساخنة' }, priceFils: 8000, durationMin: 15 },
          ],
        }),
        s('spa', 'Relaxing massage (90 min)', 'تدليك استرخائي (90 دقيقة)', 480, 90, {
          bufferAfterMin: 15,
        }),
        s('spa', 'Moroccan hammam ritual', 'طقوس الحمام المغربي', 420, 75, { bufferAfterMin: 20 }),
        s('spa', 'Express facial (non-medical)', 'تنظيف بشرة سريع (غير طبي)', 260, 45),
        s('wellness', 'Foot reflexology relaxation', 'تدليك القدمين للاسترخاء', 220, 45),
      ],
    },
  },
  {
    key: 'doorstep-glam',
    name: { en: 'Doorstep Glam', ar: 'دورستب جلام' },
    tagline: { en: 'Nails, hair and makeup at your home.', ar: 'أظافر وشعر ومكياج في منزلك.' },
    ownerName: 'Bianca Rossi',
    emirate: 'DXB',
    area: 'Arabian Ranches',
    colors: { from: [210, 140, 90], to: [250, 220, 190] },
    services: {
      branches: [
        {
          name: { en: 'Arabian Ranches base', ar: 'مقر المرابع العربية' },
          emirate: 'DXB',
          area: 'Arabian Ranches',
          open: '08:00',
          close: '22:00',
        },
      ],
      staff: [
        { name: 'Elena', title: 'Mobile nail technician' },
        { name: 'Pia', title: 'Mobile hairstylist' },
        { name: 'Lara', title: 'Mobile makeup artist' },
      ],
      services: [
        s('nails', 'Gel manicure at home', 'مانيكير جل في المنزل', 180, 60, { home: true }),
        s('hair', 'Blow-dry at home', 'تصفيف الشعر في المنزل', 170, 60, { home: true }),
        s('makeup', 'Party makeup at home', 'مكياج حفلات في المنزل', 400, 75, {
          home: true,
          cancelCutoffHours: 48,
          lateCancelRefundBps: 5000,
        }),
        s('nails', 'Mani-pedi at home', 'مانيكير وباديكير في المنزل', 290, 100, { home: true }),
      ],
      home: {
        areas: [
          { emirate: 'DXB', area: null, travelFeeFils: 7500 },
          { emirate: 'DXB', area: 'Arabian Ranches', travelFeeFils: 2500 },
        ],
      },
    },
  },

  // -------------------------------------------------------------------------------------------
  // Hybrid businesses: sell products and take bookings under one account

  {
    key: 'oud-orchid',
    name: { en: 'Oud & Orchid Salon and Shop', ar: 'صالون ومتجر العود والأوركيد' },
    tagline: {
      en: 'Salon services and the products we use.',
      ar: 'خدمات الصالون والمنتجات التي نستخدمها.',
    },
    ownerName: 'Hamda Al Ketbi',
    emirate: 'AUH',
    area: 'Al Karamah',
    colors: { from: [100, 50, 80], to: [220, 170, 200] },
    shop: {
      category: 'haircare',
      products: [
        p(
          'Salon Hair Oil',
          'زيت الشعر للصالون',
          'The oil our stylists use, now for home.',
          'الزيت الذي يستخدمه مصففونا، الآن للمنزل.',
          [v('100 ml', '100 مل', 120, 15)],
        ),
        p(
          'Oud Hair Mist',
          'رذاذ الشعر بالعود',
          'Light hair perfume with oud.',
          'عطر خفيف للشعر بالعود.',
          [v('50 ml', '50 مل', 140, 9, 165)],
        ),
        p(
          'Colour Care Shampoo',
          'شامبو العناية بالشعر المصبوغ',
          'Keeps colour vibrant for longer.',
          'يحافظ على حيوية اللون لفترة أطول.',
          [v('300 ml', '300 مل', 89, 2)],
        ),
      ],
    },
    services: {
      branches: [
        {
          name: { en: 'Al Karamah', ar: 'الكرامة' },
          emirate: 'AUH',
          area: 'Al Karamah',
          open: '09:00',
          close: '21:00',
        },
      ],
      staff: [
        { name: 'Amal', title: 'Senior stylist' },
        { name: 'Joanna', title: 'Stylist' },
        { name: 'Shaikha', title: 'Henna artist' },
      ],
      services: [
        s('hair', 'Hair treatment and blow-dry', 'علاج الشعر وتصفيفه', 220, 75),
        s('hair', 'Women’s haircut', 'قص شعر نسائي', 150, 45),
        s('makeup', 'Henna design (both hands)', 'نقش الحناء (اليدين)', 120, 45),
      ],
    },
  },
  {
    key: 'nail-nectar',
    name: { en: 'Nail Nectar Studio and Store', ar: 'استوديو ومتجر نيل نكتار' },
    tagline: {
      en: 'Book your nails and shop our polish line.',
      ar: 'احجزي موعد أظافرك وتسوقي طلاءاتنا.',
    },
    ownerName: 'Leah Park',
    emirate: 'DXB',
    area: 'Al Wasl',
    colors: { from: [220, 100, 140], to: [255, 210, 225] },
    shop: {
      category: 'makeup',
      products: [
        p(
          'Breathable Nail Polish',
          'طلاء أظافر يسمح بالتنفس',
          'Water-permeable polish in ten shades.',
          'طلاء يسمح بنفاذ الماء بعشر درجات.',
          [v('Blush', 'وردي', 45, 30), v('Coral', 'مرجاني', 45, 18), v('Navy', 'كحلي', 45, 0)],
        ),
        p(
          'Cuticle Oil Pen',
          'قلم زيت الجلد المحيط بالأظافر',
          'Jojoba and vitamin E.',
          'جوجوبا وفيتامين E.',
          [v('Standard', 'قياسي', 39, 40)],
        ),
        p(
          'Nail Care Kit',
          'مجموعة العناية بالأظافر',
          'File, buffer and cuticle pusher.',
          'مبرد وملمع ودافع للجلد.',
          [v('Standard', 'قياسي', 79, 12, 95)],
        ),
      ],
    },
    services: {
      branches: [
        {
          name: { en: 'Al Wasl Road', ar: 'شارع الوصل' },
          emirate: 'DXB',
          area: 'Al Wasl',
          open: '10:00',
          close: '21:00',
        },
      ],
      staff: [
        { name: 'Ivy', title: 'Nail technician' },
        { name: 'Noor', title: 'Nail technician' },
      ],
      services: [
        s('nails', 'Breathable polish manicure', 'مانيكير بطلاء يسمح بالتنفس', 110, 45),
        s('nails', 'Gel pedicure', 'باديكير جل', 180, 60),
      ],
    },
  },
  {
    key: 'mirage-groom',
    name: { en: 'Mirage Grooming Lounge', ar: 'ميراج لاونج للعناية الرجالية' },
    tagline: {
      en: 'Barbering and men’s grooming products.',
      ar: 'حلاقة ومنتجات العناية الرجالية.',
    },
    ownerName: 'Zayed Al Marzouqi',
    emirate: 'UAQ',
    area: 'Al Salamah',
    colors: { from: [40, 60, 50], to: [150, 180, 160] },
    shop: {
      category: 'haircare',
      products: [
        p(
          'Beard Oil',
          'زيت اللحية',
          'Softens and conditions with a cedar scent.',
          'ينعم ويرطب برائحة الأرز.',
          [v('30 ml', '30 مل', 75, 22)],
        ),
        p(
          'Matte Styling Clay',
          'صلصال تصفيف مطفي',
          'Strong hold, natural finish.',
          'تثبيت قوي بمظهر طبيعي.',
          [v('85 g', '85 غ', 69, 14)],
        ),
        p(
          'Shaving Cream',
          'كريم الحلاقة',
          'Rich lather for a smooth shave.',
          'رغوة غنية لحلاقة ناعمة.',
          [v('150 ml', '150 مل', 55, 5, 65)],
        ),
      ],
    },
    services: {
      branches: [
        {
          name: { en: 'Al Salamah', ar: 'السلامة' },
          emirate: 'UAQ',
          area: 'Al Salamah',
          open: '10:00',
          close: '23:00',
        },
      ],
      staff: [
        { name: 'Hassan', title: 'Barber' },
        { name: 'Bilal', title: 'Barber' },
      ],
      services: [
        s('barbering', 'Classic cut', 'قصة كلاسيكية', 60, 30),
        s('barbering', 'Beard sculpt', 'تشكيل اللحية', 45, 20),
        s('barbering', 'Grooming package', 'باقة العناية', 120, 60),
      ],
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Customers (all fictional, `.example` addresses)

export const DEMO_CUSTOMERS: {
  key: string;
  name: string;
  locale: 'en' | 'ar';
  emirate: Emirate;
  area: string;
}[] = [
  {
    key: 'customer.amira',
    name: 'Amira Khalil',
    locale: 'en',
    emirate: 'AUH',
    area: 'Al Reem Island',
  },
  { key: 'customer.huda', name: 'هدى الشامسي', locale: 'ar', emirate: 'AUH', area: 'Khalifa City' },
  { key: 'customer.sara', name: 'Sara Lim', locale: 'en', emirate: 'DXB', area: 'Dubai Marina' },
  {
    key: 'customer.fatma',
    name: 'فاطمة النعيمي',
    locale: 'ar',
    emirate: 'AJM',
    area: 'Al Nuaimiya',
  },
  { key: 'customer.jana', name: 'Jana Weber', locale: 'en', emirate: 'DXB', area: 'Jumeirah' },
  {
    key: 'customer.maha',
    name: 'مها الكعبي',
    locale: 'ar',
    emirate: 'AUH',
    area: 'Mohammed Bin Zayed City',
  },
  { key: 'customer.olivia', name: 'Olivia Grant', locale: 'en', emirate: 'SHJ', area: 'Al Majaz' },
  {
    key: 'customer.rawan',
    name: 'روان العلي',
    locale: 'ar',
    emirate: 'AUH',
    area: 'Saadiyat Island',
  },
  { key: 'customer.ahmed', name: 'Ahmed Saeed', locale: 'en', emirate: 'AUH', area: 'Al Mushrif' },
  {
    key: 'customer.khalid',
    name: 'خالد الحمادي',
    locale: 'ar',
    emirate: 'DXB',
    area: 'Arabian Ranches',
  },
  { key: 'customer.nina', name: 'Nina Petrova', locale: 'en', emirate: 'RAK', area: 'Al Nakheel' },
  { key: 'customer.lulwa', name: 'لولوة المهيري', locale: 'ar', emirate: 'AUH', area: 'Al Bateen' },
];

/** Short, varied review texts (fictional). */
export const REVIEW_TEXTS: { rating: number; en: string }[] = [
  { rating: 5, en: 'Arrived quickly and exactly as described. Lovely packaging.' },
  { rating: 5, en: 'Fantastic experience, the team was friendly and on time.' },
  { rating: 4, en: 'Very good quality. Delivery took one day longer than shown.' },
  { rating: 5, en: 'Already ordered again. Highly recommended.' },
  { rating: 4, en: 'Nice result, I would book again.' },
  { rating: 3, en: 'Good, but the shade was slightly different from the photo.' },
  { rating: 5, en: 'Professional and relaxing. Clean venue.' },
  { rating: 2, en: 'Started late and felt rushed this time.' },
  { rating: 4, en: 'Great value for the price.' },
  { rating: 5, en: 'Perfect for a gift, the recipient loved it.' },
];

export const DEMO_ADMIN_ROLES = [
  'superadmin',
  'operations',
  'compliance',
  'catalog',
  'finance',
  'support',
] as const;
