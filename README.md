# demo_dinhding
# GemiClue

GemiClue là một trò chơi đoán đối tượng trực tuyến theo thời gian thực, cho phép 2 người chơi tham gia cùng một phòng và cạnh tranh qua các gợi ý được tạo bởi Gemini AI.

## Tổng quan

Dự án này xây dựng một ứng dụng web chơi game đoán từ bằng Node.js, Express, Socket.io và Google Gemini API. Người chơi tạo hoặc tham gia phòng, nhận các gợi ý từ mơ hồ đến rõ ràng, rồi có thể bấm chuông để giành quyền trả lời.

## Tính năng chính

- Tạo phòng chơi và chia sẻ mã phòng
- Tham gia phòng theo thời gian thực với Socket.io
- Hệ thống gợi ý tăng dần từ vague đến rõ ràng
- Buzzer để giành quyền trả lời
- Chấm điểm theo thời điểm trả lời và số gợi ý đã dùng
- Hỗ trợ chế độ demo với dữ liệu offline
- Tích hợp Gemini API để sinh dữ liệu trò chơi và kiểm tra câu trả lời

## Công nghệ sử dụng

- Node.js
- Express.js
- Socket.io
- Google Gemini API
- dotenv
- CORS
- HTML, CSS, JavaScript

## Yêu cầu hệ thống

- Node.js 18+
- npm
- API key Gemini từ Google AI Studio

## Cài đặt

1. Clone dự án:

```bash
git clone <repository-url>
cd dinhdingdemo
```

2. Cài đặt dependencies:

```bash
npm install
```

3. Tạo file `.env` ở thư mục gốc và cấu hình:

```env
PORT=3000
GEMINI_API_KEY=your_google_gemini_api_key
```

## Chạy ứng dụng

Chạy ở chế độ phát triển:

```bash
npm run dev
```

Hoặc chạy bản production:

```bash
npm start
```

Mở trình duyệt tại:

```text
http://localhost:3000
```

## Cách chơi

1. Tạo phòng hoặc tham gia phòng bằng mã phòng.
2. Chọn danh mục và độ khó trước khi bắt đầu.
3. Khi trò chơi bắt đầu, hệ thống sẽ lần lượt đưa ra các gợi ý.
4. Người chơi có thể bấm chuông để giành quyền trả lời.
5. Nếu đoán đúng, người chơi nhận điểm và vòng chơi kết thúc.

## Cấu trúc thư mục

```text
src/
  public/         # Frontend HTML/CSS/JS
  services/       # Logic Gemini và Socket.io
  schemas/        # Schema validation cho phản hồi AI
  server.js       # Entry point của server
```

## Ghi chú

- Nếu chưa cung cấp `GEMINI_API_KEY`, ứng dụng vẫn có thể chạy ở chế độ demo hoặc dùng dữ liệu offline.
- Để có trải nghiệm tốt nhất, nên sử dụng API key hợp lệ.

## Tác giả

Dự án này được phát triển như một demo game multiplayer sử dụng trí tuệ nhân tạo.
