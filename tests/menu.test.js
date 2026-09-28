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

  describe('Update Menu Item (PUT /api/menu/:id)', () => {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'ralahami_super_secret_jwt_key_2026_change_in_production';
    const adminToken = jwt.sign(
      { id: 'admin-uuid-1234', email: 'admin@ralahami.com', role: 'ADMIN' },
      secret
    );

    test('Updates menu item image_url and details successfully', async () => {
      const querySpy = jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Updated Fish Cutlets',
            category_id: 1,
            price: '7.50',
            description: 'Updated description',
            spice_level: 'Medium',
            dietary_tags: ['Halal'],
            image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947',
            is_available: true,
          },
        ],
      });

      const response = await request(app)
        .put('/api/menu/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Updated Fish Cutlets',
          category_id: 1,
          price: 7.5,
          description: 'Updated description',
          spice_level: 'Medium',
          dietary_tags: ['Halal'],
          image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947',
          is_available: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.image_url).toBe('https://images.unsplash.com/photo-1544025162-d76694265947');
      expect(response.body.data.name).toBe('Updated Fish Cutlets');

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('UPDATE menu_items');
      expect(sql).toContain('spice_level = $5');
      expect(sql).toContain('is_available = $6');
      expect(params[7]).toBe('https://images.unsplash.com/photo-1544025162-d76694265947');
      expect(params[8]).toBe('1');
    });

    test('Accepts "image" field as fallback for image_url', async () => {
      const querySpy = jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            name: 'Dhal Tadka',
            image_url: 'https://images.unsplash.com/photo-fallback.jpg',
          },
        ],
      });

      const response = await request(app)
        .put('/api/menu/2')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dhal Tadka',
          image: 'https://images.unsplash.com/photo-fallback.jpg',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const [sql, params] = querySpy.mock.calls[0];
      expect(params[7]).toBe('https://images.unsplash.com/photo-fallback.jpg');
    });

    test('Rejects invalid dish update with 400 Validation Error', async () => {
      const response = await request(app)
        .put('/api/menu/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'AB', // too short (< 3 chars)
          price: -10, // invalid price
          description: 'Short', // too short (< 10 chars)
          spice_level: 10, // out of range (0-5)
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation Error');
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Create Menu Item (POST /api/menu)', () => {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'ralahami_super_secret_jwt_key_2026_change_in_production';
    const adminToken = jwt.sign(
      { id: 'admin-uuid-1234', email: 'admin@ralahami.com', role: 'ADMIN' },
      secret
    );

    test('Rejects creation when required fields are missing or invalid', async () => {
      const response = await request(app)
        .post('/api/menu')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'AB',
          price: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation Error');
      expect(response.body.errors).toBeDefined();
    });

    test('Creates new dish with image persistence and default spice level', async () => {
      const querySpy = jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            category_id: 1,
            name: 'Authentic Jaffna Crab Curry',
            description: 'Fresh blue swimmer crab simmered in roasted spice blend.',
            price: '28.50',
            image_url: 'https://images.unsplash.com/photo-crab-curry.jpg',
            spice_level: 4,
            dietary_tags: ['Halal', 'Seafood'],
            is_available: true,
          },
        ],
      });

      const response = await request(app)
        .post('/api/menu')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: 1,
          name: 'Authentic Jaffna Crab Curry',
          description: 'Fresh blue swimmer crab simmered in roasted spice blend.',
          price: 28.50,
          image_url: 'https://images.unsplash.com/photo-crab-curry.jpg',
          spice_level: 4,
          dietary_tags: ['Halal', 'Seafood'],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Authentic Jaffna Crab Curry');
      expect(response.body.data.image_url).toBe('https://images.unsplash.com/photo-crab-curry.jpg');

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('INSERT INTO menu_items');
      expect(params[0]).toBe(1);
      expect(params[1]).toBe('Authentic Jaffna Crab Curry');
      expect(params[4]).toBe('https://images.unsplash.com/photo-crab-curry.jpg');
    });

    test('Resolves category name to integer ID if string category is provided', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // category lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 11,
              category_id: 3,
              name: 'Mango Lassi Drink',
              description: 'Fresh mango pulp blended with homemade yogurt.',
              price: '5.50',
              image_url: '/images/default-dish.jpg',
              spice_level: 0,
              dietary_tags: ['Vegetarian'],
              is_available: true,
            },
          ],
        });

      const response = await request(app)
        .post('/api/menu')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'Beverages',
          name: 'Mango Lassi Drink',
          description: 'Fresh mango pulp blended with homemade yogurt.',
          price: 5.50,
          spice_level: 0,
          dietary_tags: ['Vegetarian'],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.category_id).toBe(3);
    });
  });
});
