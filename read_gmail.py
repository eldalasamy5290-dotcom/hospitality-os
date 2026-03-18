from __future__ import print_function
import os.path
import base64
from email.mime.text import MIMEText

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Permessi: leggere e inviare/modificare mail
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]

# CAMBIA QUESTO con la mail del manager
MANAGER_EMAIL = "eldalasamy5290@gmail.com"


def classify(text):
    t = text.lower()
    if any(k in t for k in ["book", "reservation", "table", "prenot"]):
        return "BOOKING"
    if any(k in t for k in ["complaint", "refund", "bad service", "terrible", "not happy"]):
        return "COMPLAINT"
    if any(k in t for k in ["invoice", "supplier", "order", "delivery"]):
        return "SUPPLIER"
    if any(k in t for k in ["shift", "staff", "roster", "sick", "cover"]):
        return "STAFF"
    return "OTHER"


def booking_reply_classic():
    return (
        "Hi,\n\n"
        "Thank you for your booking request.\n\n"
        "Could you please confirm:\n"
        "- Date\n- Time\n- Number of guests\n\n"
        "If you have any dietary requirements, please let us know.\n\n"
        "Once we have this, we'll confirm your reservation.\n\n"
        "Kind regards,\n"
        "HospitalityOS Test\n"
    )


def booking_reply_event():
    return (
        "Hi,\n\n"
        "Thank you for contacting us about your event.\n\n"
        "To help us organise everything, could you please tell us:\n"
        "- Date of the event\n"
        "- Start time and approximate finish time\n"
        "- Number of guests (adults / kids)\n"
        "- Type of event (birthday, corporate, wedding, etc.)\n"
        "- Approximate budget per person\n\n"
        "For food and drinks:\n"
        "- Do you prefer set menu, shared plates, or à la carte?\n"
        "- Any dietary requirements or allergies we should be aware of?\n\n"
        "Once we have these details, we can suggest menu options and a full proposal for you.\n\n"
        "Kind regards,\n"
        "HospitalityOS Test\n"
    )


def booking_reply_forward_to_manager_client():
    return (
        "Hi,\n\n"
        "Thank you for your message.\n\n"
        "I've forwarded your enquiry to our manager who will get back to you as soon as possible with all the details.\n\n"
        "Kind regards,\n"
        "HospitalityOS Test\n"
    )


def manager_notification_body(sender, subject):
    return (
        "New booking / event enquiry.\n\n"
        f"From: {sender}\n"
        f"Subject: {subject}\n\n"
        "Please check the original thread in Gmail and reply directly to the guest.\n"
    )


def get_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials.json", SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open("token.json", "w") as token:
            token.write(creds.to_json())

    return build("gmail", "v1", credentials=creds)


def send_reply(service, to_email, subject, body):
    subject_line = f"Re: {subject}" if subject else "Re: your message"

    message = MIMEText(body)
    message["to"] = to_email
    message["subject"] = subject_line

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    message_body = {"raw": raw}

    sent = service.users().messages().send(userId="me", body=message_body).execute()
    print(f"✅ Reply sent to {to_email}, id: {sent.get('id')}")


def extract_email_address(from_header):
    if "<" in from_header and ">" in from_header:
        start = from_header.find("<") + 1
        end = from_header.find(">", start)
        return from_header[start:end].strip()
    return from_header.strip()


def list_last_emails(service):
    results = service.users().messages().list(
        userId="me",
        maxResults=5,
        labelIds=["INBOX"]
    ).execute()
    messages = results.get("messages", [])

    if not messages:
        print("Nessuna email trovata.")
        return

    print("Ultime email:")
    for msg in messages:
        msg_data = service.users().messages().get(
            userId="me",
            id=msg["id"],
            format="metadata",
            metadataHeaders=["Subject", "From"]
        ).execute()

        headers = msg_data.get("payload", {}).get("headers", [])
        subject = next((h["value"] for h in headers if h["name"] == "Subject"), "")
        sender = next((h["value"] for h in headers if h["name"] == "From"), "")

        print("---------------")
        print("From:", sender)
        print("Subject:", subject)

        content = f"{sender} {subject}"
        email_type = classify(content)
        print("Type:", email_type)

        # LOGICA SPECIFICA PER BOOKING
        if email_type == "BOOKING":
            print("Booking options:")
            print("  1 = classic booking reply")
            print("  2 = event / function / pre-order info")
            print("  3 = forward to manager + notify client")
            print("  n = skip")
            choice = input("Choose 1/2/3 or n: ").strip().lower()

            to_addr = extract_email_address(sender)

            if choice == "1":
                body = booking_reply_classic()
                send = input("Send classic booking reply? (y/n): ").strip().lower()
                if send == "y":
                    send_reply(service, to_addr, subject, body)
                else:
                    print("Reply not sent.")
            elif choice == "2":
                body = booking_reply_event()
                send = input("Send event/function info reply? (y/n): ").strip().lower()
                if send == "y":
                    send_reply(service, to_addr, subject, body)
                else:
                    print("Reply not sent.")
            elif choice == "3":
                # mail al cliente
                client_body = booking_reply_forward_to_manager_client()
                send_client = input("Send client notification? (y/n): ").strip().lower()
                if send_client == "y":
                    send_reply(service, to_addr, subject, client_body)
                else:
                    print("Client notification not sent.")

                # mail al manager
                if MANAGER_EMAIL != "eldalasamy5290@gmail.com":
                    manager_body = manager_notification_body(sender, subject)
                    send_manager = input(
                        f"Send notification to manager ({MANAGER_EMAIL})? (y/n): "
                    ).strip().lower()
                    if send_manager == "y":
                        send_reply(service, MANAGER_EMAIL, subject, manager_body)
                    else:
                        print("Manager notification not sent.")
                else:
                    print("⚠️ MANAGER_EMAIL is still default, please update it in the code.")
            else:
                print("Skipped.")
        else:
            # gestione semplice per gli altri tipi (per ora solo COMPLAINT)
            if email_type == "COMPLAINT":
                body = (
                    "Hi,\n\n"
                    "Thank you for reaching out and I'm really sorry for your experience.\n"
                    "Could you please share the date and approximate time of your visit so we can investigate?\n\n"
                    "We really appreciate your feedback.\n\n"
                    "Kind regards,\n"
                    "HospitalityOS Test\n"
                )
                print("Suggested reply for COMPLAINT:")
                print(body)
                send = input("Send this complaint reply? (y/n): ").strip().lower()
                if send == "y":
                    to_addr = extract_email_address(sender)
                    send_reply(service, to_addr, subject, body)
                else:
                    print("Reply not sent.")
            else:
                print("No automatic reply for this type.")


if __name__ == "__main__":
    service = get_service()
    list_last_emails(service)
