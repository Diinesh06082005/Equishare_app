// server/services/receiptMock.js
// Simulates OCR / AI receipt itemization.
// In a real system this would call a vision API. Here we return deterministic
// realistic output based on a hash of the filename so demo results are stable.

const MOCK_RECEIPTS = [
  {
    items: [
      { name: 'Margherita Pizza',    price: 12.50 },
      { name: 'BBQ Chicken Burger', price: 14.00 },
      { name: 'Caesar Salad',       price:  9.00 },
      { name: 'Garlic Bread',       price:  4.50 },
      { name: 'Coke (2x)',          price:  5.00 },
      { name: 'Tax (8.5%)',         price:  3.83, isTax: true },
      { name: 'Service Charge',     price:  2.00, isTax: true },
    ],
    restaurant: 'The Demo Bistro',
    date: '2025-06-12',
  },
  {
    items: [
      { name: 'Butter Chicken',  price: 18.00 },
      { name: 'Garlic Naan (2)', price:  4.00 },
      { name: 'Dal Makhani',     price: 12.00 },
      { name: 'Lassi',           price:  4.50 },
      { name: 'GST (5%)',        price:  1.93, isTax: true },
    ],
    restaurant: 'Spice Garden',
    date: '2025-06-11',
  },
  {
    items: [
      { name: 'Pad Thai',           price: 11.00 },
      { name: 'Green Curry (Veg)',  price: 10.50 },
      { name: 'Spring Rolls (4pc)', price:  7.00 },
      { name: 'Jasmine Rice',       price:  2.00 },
      { name: 'Thai Iced Tea (2x)', price:  6.00 },
      { name: 'Service Tax (10%)', price:  3.65, isTax: true },
    ],
    restaurant: 'Bangkok Bites',
    date: '2025-06-10',
  },
];

/**
 * Returns a mock OCR result for the uploaded file.
 * @param {string} filename — original filename for deterministic selection
 * @param {number} [processingDelay=800] — ms to simulate processing time
 * @returns {Promise<{ restaurant, date, items: { name, price, isTax }[], total }>}
 */
async function scanReceipt(filename = '', processingDelay = 800) {
  await new Promise((r) => setTimeout(r, processingDelay));

  // Hash filename to pick a deterministic receipt template
  let hash = 0;
  for (let i = 0; i < filename.length; i++) {
    hash = (hash * 31 + filename.charCodeAt(i)) & 0xffffffff;
  }
  const template = MOCK_RECEIPTS[Math.abs(hash) % MOCK_RECEIPTS.length];

  const total = template.items.reduce((acc, item) => acc + item.price, 0);

  return {
    restaurant: template.restaurant,
    date: template.date,
    items: template.items,
    total: Math.round(total * 100) / 100,
    confidence: 0.94, // mock confidence score
  };
}

module.exports = { scanReceipt };
