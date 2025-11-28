# Loyalty Program Frontend - Features Implementation

This document describes all the features implemented for Gabriel's assigned tasks.

## Features Implemented

### Regular Users

1. **Points Page** (`/points`)
   - Displays the current available points
   - Shows user information (name, UTORid, verification status)

2. **QR Code Page** (`/qr-code`)
   - Displays the user's QR code for initiating transactions
   - Contains the user's UTORid

3. **Transfer Points Page** (`/transfer`)
   - Allows manual entry of a user ID to transfer points
   - Shows available points
   - Includes optional remark field

4. **Point Redemption Request Page** (`/redemption`)
   - Allows users to create a redemption request
   - Validates against available points
   - Redirects to QR code display after creation

5. **Redemption QR Code Page** (`/redemption-qr`)
   - Displays the QR code of an unprocessed redemption request
   - Shows transaction ID for cashier processing
   - Allows checking status of redemption

### Other Models

6. **Promotions Page** (`/promotions`)
   - Displays all available promotions
   - Shows active/inactive status
   - Displays promotion details (type, rate, points, dates)

7. **Events List Page** (`/events`)
   - Displays all published events
   - Shows event status (Upcoming, Ongoing, Ended)
   - Displays capacity and points information

8. **Event Detail Page** (`/events/:id`)
   - Shows detailed event information
   - Allows users to RSVP to events
   - Displays event location, time, capacity
   - Shows RSVPed guests count

9. **Transactions History Page** (`/transactions`)
   - Displays all past transactions for the logged-in user
   - Includes filters for:
     - Transaction type
     - Amount range (min/max)
   - Includes sorting by:
     - Date
     - Amount
     - Type
   - Implements pagination (10 items per page)
   - Each transaction is displayed with:
     - Distinct colors for each transaction type
     - Sender/receiver UTORid (for transfers)
     - Transaction details
     - Date and time

## Technologies Used

- React 19
- React Router DOM (routing)
- Axios (API calls)
- qrcode.react (QR code generation)
- Tailwind CSS (styling)
- Vite (build tool)

## Transaction Type Colors

- **Purchase**: Green (income)
- **Transfer**: Blue
- **Redemption**: Red (expense)
- **Adjustment**: Yellow
- **Event**: Purple
