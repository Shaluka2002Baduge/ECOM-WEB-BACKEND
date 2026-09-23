const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');

describe('Menu & Categories Module (Presentation & Filtering)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Categories (GET /api/menu/categories)', () => {
    test('Fetches all active menu categories with HTTP 200', async () => {
      const mockCategories = [
        { id: 1, name: 'Starters & Short Eats', slug: 'starters' },
        { id: 2, name: 'Clay Pot Curries & Rice', slug: 'curries' },
      ];

      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: mockCategories,
      });

      const response = await request(app).get('/api/menu/categories');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe('Starters & Short Eats');
    });
  });

  describe('Menu Items with Dietary Filters (GET /api/menu/items)', () => {
    test('Fetches all menu items without query filters', async () => {
      const mockItems = [
        {
          id: 1,
          name: 'Fish Cutlets',
          price: '6.50',
          image_alt_text: 'Plate of crispy fish cutlets with lime',
          is_vegan: false,
          is_halal: true,
          is_gluten_free: false,
          is_available: true,
        },
      ];

      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: mockItems,
      });

      const response = await request(app).get('/api/menu/items');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
      expect(response.body.data[0].name).toBe('Fish Cutlets');
      expect(response.body.data[0].image_alt_text).toBeDefined();
    });

    test('Applies dietary filters for isVegan and isHalal correctly', async () => {
      const querySpy = jest.spyOn(db, 'query').mockImplementation((sql, params) => {
        return Promise.resolve({
          rows: [
            {
              id: 4,
              name: 'Creamy Dhal Tadka',
              price: '8.50',
              image_alt_text: 'Warm yellow lentil curry with curry leaves',
              is_vegan: true,
              is_halal: true,
              is_gluten_free: true,
            },
          ],
        });
      });

      const response = await request(app).get('/api/menu/items?isVegan=true&isHalal=true');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data[0].is_vegan).toBe(true);
      expect(response.body.data[0].is_halal).toBe(true);

      // Verify that query parameters were passed to the SQL parameterized query
      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('is_vegan');
      expect(sql).toContain('is_halal');
      expect(params).toContain(true);
    });

    test('Filters by categoryId', async () => {
      const querySpy = jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [],
      });

      const response = await request(app).get('/api/menu/items?categoryId=2');

      expect(response.status).toBe(200);
      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('category_id');
      expect(params).toContain('2');
    });
  });
});
