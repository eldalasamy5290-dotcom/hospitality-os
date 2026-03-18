# HospitalityOS – Email Test Suite v1

## Test 1 – Simple booking

**Subject:** Table booking

**Body:**
Hi,

I would like to book a table for 2 people tomorrow at 7pm.

Thanks
Michael

**Expected result:**
- classification: booking_request
- people: 2
- date: tomorrow
- time: 19:00
- status: pending or confirmed
- reply: yes

## Test 2 – Booking without time

**Subject:** Reservation

**Body:**
Hi,

Can I book a table for 4 people this Saturday?

Thank you
Anna

**Expected result:**
- classification: booking_request
- people: 4
- date: Saturday
- time: null
- status: needs_info
- reply: ask what time they would like

