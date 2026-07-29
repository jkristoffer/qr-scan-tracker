import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from 'react-email';

export interface QrTicketEmailProps {
  eventName: string;
  registrationAt: string | null;
  venue: string | null;
  guestName: string;
  barcode: string;
  contentId: string;
  isVIP: boolean;
  isStaff: boolean;
}

export function QrTicketEmail({
  eventName,
  registrationAt,
  venue,
  guestName,
  barcode,
  contentId,
  isVIP,
  isStaff,
}: QrTicketEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{guestName}, your QR entry pass for {eventName} is ready.</Preview>
      <Body style={body}>
        <Container style={shell}>
          <Section style={{ ...header, ...(isStaff ? staffHeader : {}) }}>
            <Text style={eyebrow}>{isStaff ? 'STAFF ENTRY PASS' : isVIP ? 'VIP ENTRY PASS' : 'ENTRY PASS'}</Text>
            <Heading style={eventHeading}>{eventName}</Heading>
            <Text style={preparedFor}>Prepared for {guestName}</Text>
          </Section>

          <Section style={content}>
            <Heading as="h2" style={greeting}>Hi {guestName},</Heading>
            <Text style={intro}>
              Your entry pass is ready. Present the QR code below when you arrive at check-in.
            </Text>
            <Text style={eventDetails}>
              Registration: {registrationAt ? new Date(registrationAt).toLocaleString() : 'Date and time to be announced'}<br />
              Venue: {venue || 'To be announced'}
            </Text>

            <Section style={{ ...ticket, ...(isVIP ? vipTicket : {}), ...(isStaff ? staffTicket : {}) }}>
              <Text style={ticketLabel}>SCAN AT CHECK-IN</Text>
              <Img
                src={`cid:${contentId}`}
                alt={`QR entry pass for ${guestName}`}
                width="260"
                height="260"
                style={qrCode}
              />
              <Text style={codeLabel}>TICKET CODE</Text>
              <Text style={code}>{barcode}</Text>
            </Section>

            <Heading as="h3" style={instructionsHeading}>Before you arrive</Heading>
            <Text style={instruction}>
              <span style={stepNumber}>1</span> Keep this email easy to access on your phone.
            </Text>
            <Text style={instruction}>
              <span style={stepNumber}>2</span> Increase your screen brightness if the QR code is difficult to scan.
            </Text>

            <Section style={notice}>
              <Text style={noticeText}>
                This pass is unique to you. Please do not forward or share it with anyone else.
              </Text>
            </Section>

            <Hr style={divider} />
            <Text style={footer}>
              Issued for {guestName} for {eventName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default QrTicketEmail;

const body = {
  margin: '0',
  backgroundColor: '#f2f2ee',
  color: '#161618',
  fontFamily: 'Arial, Helvetica, sans-serif',
};

const shell = {
  width: '100%',
  maxWidth: '600px',
  margin: '0 auto',
  padding: '32px 12px',
};

const header = {
  backgroundColor: '#161618',
  borderRadius: '18px 18px 0 0',
  padding: '34px 36px 32px',
};

const staffHeader = {
  backgroundColor: '#2563eb',
  backgroundImage: 'linear-gradient(135deg, #172554 0%, #2563eb 55%, #38bdf8 100%)',
};

const eyebrow = {
  margin: '0 0 14px',
  color: '#b9b9b3',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.2em',
  lineHeight: '16px',
};

const eventHeading = {
  margin: '0',
  color: '#ffffff',
  fontSize: '30px',
  fontWeight: '700',
  letterSpacing: '-0.02em',
  lineHeight: '38px',
};

const preparedFor = {
  margin: '14px 0 0',
  color: '#d6d6d0',
  fontSize: '14px',
  lineHeight: '21px',
};

const content = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e2dc',
  borderTop: '0',
  borderRadius: '0 0 18px 18px',
  padding: '34px 36px 30px',
};

const greeting = {
  margin: '0 0 10px',
  color: '#161618',
  fontSize: '22px',
  fontWeight: '700',
  lineHeight: '29px',
};

const intro = {
  margin: '0 0 26px',
  color: '#555550',
  fontSize: '16px',
  lineHeight: '25px',
};

const eventDetails = {
  margin: '-10px 0 24px',
  color: '#555550',
  fontSize: '14px',
  lineHeight: '22px',
};

const ticket = {
  backgroundColor: '#fafaf7',
  border: '1px solid #deded8',
  borderRadius: '14px',
  padding: '26px 20px 24px',
  textAlign: 'center' as const,
};

const ticketLabel = {
  margin: '0 0 18px',
  color: '#666660',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.16em',
  lineHeight: '16px',
};

const qrCode = {
  display: 'block',
  width: '100%',
  maxWidth: '260px',
  height: 'auto',
  margin: '0 auto 20px',
  backgroundColor: '#ffffff',
  border: '10px solid #ffffff',
  borderRadius: '10px',
};

const vipTicket = {
  backgroundColor: '#fff2c4',
  backgroundImage: 'linear-gradient(135deg, #fffef9 0%, #fff2c4 54%, #ebcf7a 100%)',
  border: '2px solid #eee4c9',
  boxShadow: '0 9px 24px rgba(128, 96, 30, 0.14)',
};

const staffTicket = {
  backgroundColor: '#eff6ff',
  backgroundImage: 'linear-gradient(135deg, #ffffff 0%, #dbeafe 54%, #93c5fd 100%)',
  border: '2px solid #bfdbfe',
  boxShadow: '0 9px 24px rgba(30, 64, 175, 0.14)',
};

const codeLabel = {
  margin: '0 0 5px',
  color: '#85857f',
  fontSize: '10px',
  fontWeight: '700',
  letterSpacing: '0.14em',
  lineHeight: '15px',
};

const code = {
  margin: '0',
  color: '#29292b',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '14px',
  fontWeight: '700',
  letterSpacing: '0.08em',
  lineHeight: '21px',
  overflowWrap: 'anywhere' as const,
};

const instructionsHeading = {
  margin: '30px 0 14px',
  color: '#161618',
  fontSize: '17px',
  fontWeight: '700',
  lineHeight: '24px',
};

const instruction = {
  margin: '0 0 11px',
  color: '#555550',
  fontSize: '14px',
  lineHeight: '22px',
};

const stepNumber = {
  display: 'inline-block',
  width: '22px',
  height: '22px',
  marginRight: '8px',
  backgroundColor: '#161618',
  borderRadius: '11px',
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: '700',
  lineHeight: '22px',
  textAlign: 'center' as const,
};

const notice = {
  marginTop: '25px',
  backgroundColor: '#f1f1ed',
  borderRadius: '10px',
  padding: '14px 16px',
};

const noticeText = {
  margin: '0',
  color: '#555550',
  fontSize: '13px',
  lineHeight: '20px',
};

const divider = {
  margin: '28px 0 20px',
  borderColor: '#e4e4de',
};

const footer = {
  margin: '0',
  color: '#85857f',
  fontSize: '12px',
  lineHeight: '18px',
  textAlign: 'center' as const,
};
