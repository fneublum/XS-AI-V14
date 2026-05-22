-- Collapse the two pre-shipment booking statuses ('BOOKED' and
-- 'CONFIRMED') into a single 'AVAILABLE' status. The downstream stages
-- ('LOADED', 'DEPARTED', 'SHIPPED', 'CANCELLED') stay untouched.

update bookings
set    status = 'AVAILABLE'
where  status in ('BOOKED', 'CONFIRMED');
