const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const reservationService = require('../src/modules/reservations/reservationService');

describe('Dynamic Dine-In Table Availability & Live Table Release Workflow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Operating Hours & Availability Validation', () => {
    test('Identifies operating hours strictly between 12:30 PM and 11:30 PM (12:30 - 23:30)', () => {
      expect(reservationService.isOperatingHours('12:30')).toBe(true);
      expect(reservationService.isOperatingHours('14:00')).toBe(true);
      expect(reservationService.isOperatingHours('23:30')).toBe(true);
      expect(reservationService.isOperatingHours('2026-09-28T19:30:00')).toBe(true);

      // Outside operating hours
      expect(reservationService.isOperatingHours('11:00')).toBe(false);
      expect(reservationService.isOperatingHours('12:29')).toBe(false);
      expect(reservationService.isOperatingHours('23:31')).toBe(false);
      expect(reservationService.isOperatingHours('01:00')).toBe(false);
    });

    test('GET /api/reservations/check-availability returns outside operating hours when time is 10:00', async () => {
      const response = await request(app)
        .get('/api/reservations/check-availability?date=2026-10-01&time=10:00');

      expect(response.status).toBe(200);
      expect(response.body.isWithinHours).toBe(false);
      expect(response.body.halls).toBeDefined();
      expect(response.body.halls['Royal Dining Hall']).toBeDefined();
      expect(response.body.halls['Royal Dining Hall'].isFullyBooked).toBe(true);
      expect(response.body.halls['Royal Dining Hall'].tables[0].available).toBe(false);
      expect(response.body.halls['Royal Dining Hall'].tables[0].reason).toMatch(/Outside operating hours/i);
    });

    test('GET /api/reservations/check-availability returns table availability structure when within operating hours', async () => {
      // Mock tables in DB
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            { id: 1, hall_name: 'Royal Dining Hall', table_number: 'Table 1', status: 'AVAILABLE', capacity: 4 },
            { id: 2, hall_name: 'Royal Dining Hall', table_number: 'Table 2', status: 'AVAILABLE', capacity: 4 },
            { id: 3, hall_name: 'Royal Dining Hall', table_number: 'Table 3', status: 'AVAILABLE', capacity: 4 },
            { id: 4, hall_name: 'Royal Dining Hall', table_number: 'Table 4', status: 'AVAILABLE', capacity: 4 },
            { id: 5, hall_name: 'Balcony Court', table_number: 'Table 1', status: 'AVAILABLE', capacity: 4 },
            { id: 6, hall_name: 'Balcony Court', table_number: 'Table 2', status: 'AVAILABLE', capacity: 4 },
            { id: 7, hall_name: 'Balcony Court', table_number: 'Table 3', status: 'AVAILABLE', capacity: 4 },
            { id: 8, hall_name: 'Balcony Court', table_number: 'Table 4', status: 'AVAILABLE', capacity: 4 },
            { id: 9, hall_name: 'Private Suite', table_number: 'Table 1', status: 'AVAILABLE', capacity: 4 },
            { id: 10, hall_name: 'Private Suite', table_number: 'Table 2', status: 'AVAILABLE', capacity: 4 },
            { id: 11, hall_name: 'Private Suite', table_number: 'Table 3', status: 'AVAILABLE', capacity: 4 },
            { id: 12, hall_name: 'Private Suite', table_number: 'Table 4', status: 'AVAILABLE', capacity: 4 },
          ],
        }) // tables lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 50,
              table_id: 2,
              hall_name: 'Royal Dining Hall',
              table_number: 'Table 2',
              status: 'CONFIRMED',
              reservation_time: '2026-10-01T19:00:00.000Z',
            },
          ],
        }); // overlapping active reservations lookup

      const response = await request(app)
        .get('/api/reservations/check-availability?date=2026-10-01&time=19:30');

      expect(response.status).toBe(200);
      expect(response.body.isWithinHours).toBe(true);
      expect(response.body.halls).toBeDefined();

      const royalHall = response.body.halls['Royal Dining Hall'];
      expect(royalHall).toBeDefined();
      expect(royalHall.isFullyBooked).toBe(false);

      // Table 1 should be available
      const table1 = royalHall.tables.find((t) => t.tableNumber === 'Table 1');
      expect(table1.available).toBe(true);

      // Table 2 is booked
      const table2 = royalHall.tables.find((t) => t.tableNumber === 'Table 2');
      expect(table2.available).toBe(false);
      expect(table2.reason).toBe('Booked');
    });

    test('Completed or Cancelled reservations do NOT block availability', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            { id: 1, hall_name: 'Royal Dining Hall', table_number: 'Table 1', status: 'AVAILABLE', capacity: 4 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [], // No active CONFIRMED or SEATED reservations (COMPLETED/CANCELLED filtered out)
        });

      const result = await reservationService.checkDynamicAvailability('2026-10-01', '19:30');
      expect(result.isWithinHours).toBe(true);
      const table1 = result.halls['Royal Dining Hall'].tables.find((t) => t.tableNumber === 'Table 1');
      expect(table1.available).toBe(true);
    });
  });

  describe('2. Conflict Enforcement on POST /api/orders', () => {
    test('Rejects Dine-in order if patron full name is missing with 400 Bad Request', async () => {
      const response = await request(app)
        .post('/api/orders')
        .send({
          fulfillment_type: 'Dine-In',
          reservation_time: '2026-10-01T19:30:00',
          items: [{ id: 1, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/Customer full name is required for reservations/i);
    });

    test('Rejects Dine-in order outside operating hours with 400 Bad Request', async () => {
      const response = await request(app)
        .post('/api/orders')
        .send({
          fulfillment_type: 'Dine-In',
          customer_name: 'Kamal Perera',
          reservation_time: '2026-10-01T08:00:00',
          items: [{ id: 1, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/between 12:30 PM and 11:30 PM/i);
    });

    test('Rejects Dine-in order with 409 Conflict if table is already reserved in time slot', async () => {
      // Mock conflict check query returning existing reservation
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: 1, hall_name: 'Royal Dining Hall', table_number: 'Table 1', status: 'AVAILABLE' }],
        }) // table lookup
        .mockResolvedValueOnce({
          rows: [{ id: 99, status: 'CONFIRMED' }],
        }); // conflict query found existing booking

      const response = await request(app)
        .post('/api/orders')
        .send({
          fulfillment_type: 'Dine-In',
          customer_name: 'Kamal Perera',
          hall_name: 'Royal Dining Hall',
          table_number: 'Table 1',
          reservation_time: '2026-10-01T19:30:00.000Z',
          items: [{ id: 1, quantity: 1 }],
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/already booked for this time slot/i);
    });
  });

  describe('3. Admin Live Table Release & Status Toggle', () => {
    test('PUT /api/reservations/tables/:id/status frees table and marks active reservations COMPLETED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: 1, hall_name: 'Royal Dining Hall', table_number: 'Table 1', status: 'OCCUPIED' }],
        }) // table check
        .mockResolvedValueOnce({
          rows: [{ id: 1, hall_name: 'Royal Dining Hall', table_number: 'Table 1', status: 'AVAILABLE', is_active: true }],
        }) // update tables query
        .mockResolvedValueOnce({
          rows: [{ id: 99, status: 'COMPLETED' }],
        }); // update reservations query

      const response = await request(app)
        .put('/api/reservations/tables/1/status')
        .send({ status: 'AVAILABLE' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('AVAILABLE');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reservations'),
        expect.anything()
      );
    });

    test('PUT /api/reservations/tables/:id/status allows marking OCCUPIED or RESERVED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: 3, hall_name: 'Balcony Court', table_number: 'Table 3', status: 'AVAILABLE' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 3, hall_name: 'Balcony Court', table_number: 'Table 3', status: 'OCCUPIED', is_active: false }],
        });

      const response = await request(app)
        .put('/api/reservations/tables/3/status')
        .send({ status: 'OCCUPIED' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('OCCUPIED');
    });

    test('DELETE /api/reservations/:id permanently deletes record and releases table to AVAILABLE', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [] }) // order lookup
        .mockResolvedValueOnce({
          rows: [{ id: 45, hall_name: 'Royal Dining Hall', table_number: 'Table 2', table_id: 2, status: 'CONFIRMED' }],
        }) // check reservation
        .mockResolvedValueOnce({ rowCount: 1 }) // update tables to AVAILABLE
        .mockResolvedValueOnce({ rowCount: 1 }) // delete reservation
        .mockResolvedValueOnce({ rowCount: 1 }); // delete orders

      const response = await request(app).delete('/api/reservations/45');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toMatch(/Reservation deleted and table released to Available/i);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM reservations WHERE id::text = $1'),
        ['45', null]
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE tables \n         SET status = 'AVAILABLE'"),
        expect.arrayContaining([2, 'Royal Dining Hall', 'Table 2'])
      );
    });

    test('PUT /api/reservations/:id/depart marks status COMPLETED and releases table to AVAILABLE', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [] }) // order lookup
        .mockResolvedValueOnce({
          rows: [{ id: 60, hall_name: 'Private Suite', table_number: 'Table 4', table_id: 12, status: 'SEATED' }],
        }) // check reservation
        .mockResolvedValueOnce({
          rows: [{ id: 60, hall_name: 'Private Suite', table_number: 'Table 4', table_id: 12, status: 'COMPLETED' }],
        }) // update reservation
        .mockResolvedValueOnce({ rowCount: 1 }); // update tables to AVAILABLE

      const response = await request(app).put('/api/reservations/60/depart');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE tables\n       SET status = 'AVAILABLE'"),
        expect.arrayContaining([12, 'Private Suite', 'Table 4'])
      );
    });

    test('POST /api/reservations/admin-book creates confirmed booking and marks table RESERVED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: 5, hall_name: 'Balcony Court', table_number: 'Table 1' }],
        }) // table lookup
        .mockResolvedValueOnce({
          rows: [{
            id: 88,
            hall_name: 'Balcony Court',
            table_number: 'Table 1',
            patron_name: 'VIP Guest Walkin',
            status: 'CONFIRMED',
            booking_source: 'Walk-In / Admin'
          }],
        }) // insert reservation
        .mockResolvedValueOnce({ rowCount: 1 }); // update tables to RESERVED

      const response = await request(app)
        .post('/api/reservations/admin-book')
        .send({
          patron_name: 'VIP Guest Walkin',
          phone: '+94771122334',
          email: 'vipwalkin@example.lk',
          reservation_date: '2026-10-02',
          reservation_time: '19:30',
          hall_name: 'Balcony Court',
          table_number: 'Table 1',
          party_size: 2,
          notes: 'Special window seating'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.patron_name).toBe('VIP Guest Walkin');
      expect(response.body.data.status).toBe('CONFIRMED');
      expect(response.body.data.booking_source).toBe('Walk-In / Admin');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE tables\n       SET status = 'RESERVED'"),
        expect.arrayContaining([5, 'Balcony Court', 'Table 1'])
      );
    });
  });
});
