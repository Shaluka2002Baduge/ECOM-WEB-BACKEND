-- ====================================================================
-- RALAHAMI RESTAURANT - ENTERPRISE SEED DATA
-- University of Bedfordshire (CIS007-3 / CIS045-3)
-- Initial Baseline Data for Testing and Verification
-- Default password for all seeded users: "Password123!"
-- BCrypt Hash: $2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2
-- ====================================================================

-- 1. USERS SEED
INSERT INTO users (id, display_name, email, password_hash, phone, role)
VALUES
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'System Administrator', 'admin@ralahami.com', '$2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2', '+94771234567', 'ADMIN'),
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'General Manager', 'manager@ralahami.com', '$2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2', '+94772345678', 'MANAGER'),
  ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'Head Chef Silva', 'kitchen@ralahami.com', '$2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2', '+94773456789', 'KITCHEN_STAFF'),
  ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Dining Waiter Perera', 'waiter@ralahami.com', '$2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2', '+94774567890', 'WAITER'),
  ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'Nimal Fernando', 'customer@ralahami.com', '$2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2', '+94775678901', 'CUSTOMER'),
  ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'Sarah Jenkins', 'sarah.j@example.com', '$2b$10$fG6T8XzWpZ7Z6bA07dUkue/zM8y12QeO9s3Y3cK5oJ12tH11Q1sW2', '+447911123456', 'CUSTOMER')
ON CONFLICT (email) DO NOTHING;

-- 2. USER ADDRESSES SEED
INSERT INTO user_addresses (user_id, address_line1, address_line2, city, state_province, postal_code, is_default)
VALUES
  ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', '45 Galle Face Terrace', 'Apt 4B', 'Colombo', 'Western Province', '00300', TRUE),
  ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', '12 Marina Promenade', NULL, 'Colombo', 'Western Province', '00100', TRUE)
ON CONFLICT DO NOTHING;

-- 3. CATEGORIES SEED
INSERT INTO categories (id, name, slug, description)
VALUES
  (1, 'Starters & Short Eats', 'starters-and-short-eats', 'Authentic savory Lankan bites, cutlets, and crispy pastry rolls.'),
  (2, 'Clay Pot Curries & Rice', 'curries-and-rice', 'Rich coconut milk curries infused with roasted spices, served with steamed heirloom rice.'),
  (3, 'Signature Kottu & Roti', 'kottu-and-roti', 'Chopped Godamba roti tossed vigorously on hot griddles with farm spices and cheeses.'),
  (4, 'Coastal Fresh Seafood', 'fresh-seafood', 'Daily catch lagoon crabs, prawns, and cuttlefish cooked in aromatic sauces.'),
  (5, 'Authentic Desserts', 'authentic-desserts', 'Traditional sweet delicacies including spiced jaggery puddings and tropical treats.'),
  (6, 'Craft Beverages', 'craft-beverages', 'Fresh island coolers, king coconut blends, and spiced Ceylon tea.')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

-- 4. MENU ITEMS SEED (WCAG Compliant image_alt_text + Dietary tags)
INSERT INTO menu_items (id, category_id, name, description, price, image_url, image_alt_text, is_vegan, is_halal, is_gluten_free, is_available)
VALUES
  (1, 1, 'Ceylon Spiced Fish Cutlets (4 pcs)', 'Crispy breadcrumbed mackerel and spiced potato croquettes served with spicy chili lime dip.', 6.50, 'https://images.unsplash.com/photo-1541529086526-db283c563270', 'Plate of four golden-brown breaded fish cutlets garnished with fresh coriander and lime', FALSE, TRUE, FALSE, TRUE),
  (2, 1, 'Crispy Vegetable Samosas (3 pcs)', 'Flaky pastry triangles filled with tempered spiced potatoes, peas, and mustard seeds.', 5.00, 'https://images.unsplash.com/photo-1601050690597-df0568f70950', 'Three crispy fried samosas resting on a ceramic dish accompanied by mint chutney', TRUE, TRUE, FALSE, TRUE),
  (3, 2, 'Ceylon Black Pepper Chicken Curry', 'Tender chicken slow-simmered in roasted coriander, black pepper, and thick coconut milk gravy.', 13.50, 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db', 'Traditional clay pot containing dark aromatic chicken curry with whole spices and coconut cream', FALSE, TRUE, TRUE, TRUE),
  (4, 2, 'Creamy Dhal Tadka with Coconut Cream', 'Red lentils tempered with garlic, shallots, dried chilies, and tempered curry leaves.', 8.50, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d', 'A warm bowl of yellow lentil curry infused with coconut cream and roasted curry leaf garnish', TRUE, TRUE, TRUE, TRUE),
  (5, 3, 'Signature Cheese Chicken Kottu', 'Hand-shredded flatbread chopped on griddle with roast chicken, egg, leeks, and melted cheddar.', 14.00, 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47', 'Sizzling hot plate of chopped roti, chicken, and melted cheese seasoned with chili gravy', FALSE, TRUE, FALSE, TRUE),
  (6, 4, 'Jaffna Fiery Lagoon Crab Curry', 'Succulent fresh lagoon crab cooked in rich toasted curry powder, fenugreek, and murunga leaves.', 24.00, 'https://images.unsplash.com/photo-1559847844-5315695dadae', 'Whole fresh lagoon crab simmered in a dark red fiery spicy Jaffna curry broth', FALSE, TRUE, TRUE, TRUE),
  (7, 5, 'Traditional Spiced Watalappam', 'Silky steamed coconut milk and kitul jaggery custard spiced with nutmeg, cardamom, and roasted cashews.', 6.00, 'https://images.unsplash.com/photo-1587314168485-3236d6710814', 'Individual serving of caramel-brown jaggery custard topped with golden roasted cashew nuts', FALSE, TRUE, TRUE, TRUE),
  (8, 6, 'Chilled King Coconut with Lime & Mint', 'Freshly tapped Thambili water served cold over crushed ice with freshly squeezed lime and garden mint.', 4.50, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd', 'Tall glass of clear chilled king coconut water with a lime wheel and fresh green mint leaves', TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price;

-- 5. INVENTORY ITEMS SEED
INSERT INTO inventory_items (id, name, unit, current_stock, minimum_threshold)
VALUES
  (1, 'Boneless Chicken Breast', 'kg', 45.00, 10.00),
  (2, 'Lagoon Mud Crab', 'kg', 20.00, 5.00),
  (3, 'Canned Mackerel Fish', 'kg', 15.00, 3.00),
  (4, 'Godamba Roti Sheets', 'pieces', 120.00, 30.00),
  (5, 'Thick Coconut Milk', 'liters', 50.00, 12.00),
  (6, 'Ceylon Roasted Curry Powder', 'kg', 8.50, 2.00),
  (7, 'Kitul Palm Jaggery', 'kg', 12.00, 3.00),
  (8, 'Red Split Lentils', 'kg', 35.00, 8.00),
  (9, 'King Coconut', 'units', 60.00, 15.00),
  (10, 'Cheddar Cheese Block', 'kg', 14.00, 4.00)
ON CONFLICT (id) DO UPDATE SET current_stock = EXCLUDED.current_stock;

-- 6. MENU ITEM RECIPES SEED (Bill of Materials)
INSERT INTO menu_item_recipes (menu_item_id, inventory_item_id, quantity_required)
VALUES
  -- Dish 1: Fish Cutlets requires Mackerel (0.15kg)
  (1, 3, 0.15),
  -- Dish 3: Chicken Curry requires Chicken (0.35kg), Coconut Milk (0.15L), Spices (0.03kg)
  (3, 1, 0.35),
  (3, 5, 0.15),
  (3, 6, 0.03),
  -- Dish 4: Dhal requires Lentils (0.15kg), Coconut Milk (0.10L)
  (4, 8, 0.15),
  (4, 5, 0.10),
  -- Dish 5: Cheese Chicken Kottu requires Roti (2 pcs), Chicken (0.20kg), Cheese (0.08kg)
  (5, 4, 2.00),
  (5, 1, 0.20),
  (5, 10, 0.08),
  -- Dish 6: Crab Curry requires Lagoon Crab (0.60kg), Spices (0.05kg), Coconut Milk (0.10L)
  (6, 2, 0.60),
  (6, 6, 0.05),
  (6, 5, 0.10),
  -- Dish 7: Watalappam requires Coconut Milk (0.12L), Jaggery (0.08kg)
  (7, 5, 0.12),
  (7, 7, 0.08),
  -- Dish 8: King Coconut Drink requires 1 King Coconut
  (8, 9, 1.00)
ON CONFLICT (menu_item_id, inventory_item_id) DO NOTHING;

-- 7. DINING TABLES SEED
INSERT INTO tables (id, table_number, seating_capacity, location_description, is_active)
VALUES
  (1, 'T-01', 2, 'Cozy window corner view', TRUE),
  (2, 'T-02', 2, 'Intimate garden veranda', TRUE),
  (3, 'T-03', 4, 'Central dining hall center', TRUE),
  (4, 'T-04', 4, 'Central dining hall window', TRUE),
  (5, 'T-05', 6, 'Family banquet booth', TRUE),
  (6, 'T-06', 6, 'Family banquet booth', TRUE),
  (7, 'T-07', 8, 'Executive private alcove', TRUE),
  (8, 'T-08', 10, 'VIP Private dining suite', TRUE)
ON CONFLICT (id) DO UPDATE SET table_number = EXCLUDED.table_number;

-- 8. SAMPLE RESERVATIONS SEED
INSERT INTO reservations (id, user_id, table_id, party_size, reservation_time, status, special_requests)
VALUES
  (1, 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 3, 4, CURRENT_TIMESTAMP + INTERVAL '2 days', 'CONFIRMED', 'High chair needed for child.'),
  (2, 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 1, 2, CURRENT_TIMESTAMP + INTERVAL '1 day', 'PENDING', 'Window seating preferred for anniversary.')
ON CONFLICT (id) DO NOTHING;

-- 9. SAMPLE ORDERS & ORDER ITEMS SEED
INSERT INTO orders (id, user_id, status, total_amount, order_type, notes)
VALUES
  (1, 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'CONFIRMED', 34.00, 'DINE_IN', 'Please prepare medium spicy.'),
  (2, 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'COMPLETED', 20.00, 'TAKEAWAY', 'Packed in eco-friendly boxes.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_items (id, order_id, menu_item_id, quantity, unit_price, special_instructions)
VALUES
  (1, 1, 3, 2, 13.50, 'Extra gravy on the side'),
  (2, 1, 7, 1, 6.00, 'Extra roasted cashews'),
  (3, 2, 5, 1, 14.00, 'Mild cheese preference'),
  (4, 2, 7, 1, 6.00, NULL)
ON CONFLICT (id) DO NOTHING;

-- 10. SAMPLE PAYMENTS SEED
INSERT INTO payments (id, order_id, amount, status, payment_method, transaction_reference)
VALUES
  (1, 1, 34.00, 'PAID', 'CREDIT_CARD', 'TXN_RALAHAMI_20260923_001'),
  (2, 2, 20.00, 'PAID', 'ONLINE', 'TXN_RALAHAMI_20260923_002')
ON CONFLICT (id) DO NOTHING;

-- 11. SAMPLE REVIEWS SEED
INSERT INTO reviews (id, order_id, user_id, rating, comment, is_approved)
VALUES
  (1, 2, 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 5, 'The Cheese Chicken Kottu was sensational! Excellent balance of spices and warmth.', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Reset primary key sequences to avoid serial ID collision on new inserts
SELECT setval('categories_id_seq', COALESCE((SELECT MAX(id) FROM categories), 1));
SELECT setval('menu_items_id_seq', COALESCE((SELECT MAX(id) FROM menu_items), 1));
SELECT setval('inventory_items_id_seq', COALESCE((SELECT MAX(id) FROM inventory_items), 1));
SELECT setval('menu_item_recipes_id_seq', COALESCE((SELECT MAX(id) FROM menu_item_recipes), 1));
SELECT setval('tables_id_seq', COALESCE((SELECT MAX(id) FROM tables), 1));
SELECT setval('reservations_id_seq', COALESCE((SELECT MAX(id) FROM reservations), 1));
SELECT setval('orders_id_seq', COALESCE((SELECT MAX(id) FROM orders), 1));
SELECT setval('order_items_id_seq', COALESCE((SELECT MAX(id) FROM order_items), 1));
SELECT setval('payments_id_seq', COALESCE((SELECT MAX(id) FROM payments), 1));
SELECT setval('reviews_id_seq', COALESCE((SELECT MAX(id) FROM reviews), 1));
