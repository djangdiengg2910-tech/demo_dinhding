# Kế hoạch phát triển dự án GemiClue

## 1. Tổng quan dự án
GemiClue là một trò chơi đoán đối tượng trực tuyến theo thời gian thực, cho phép hai người chơi tham gia cùng một phòng và cạnh tranh thông qua các gợi ý được sinh ra bởi Google Gemini AI. Dự án mang mục tiêu kết hợp trò chơi tương tác, mạng realtime và trí tuệ nhân tạo vào một trải nghiệm đơn giản nhưng hấp dẫn.

## 2. Mục tiêu sản phẩm
- Cho phép người chơi tạo hoặc tham gia phòng chơi bằng mã phòng.
- Tạo vòng chơi với các gợi ý tăng dần từ mơ hồ đến rõ ràng.
- Hỗ trợ tính năng buzzer để giành quyền trả lời.
- Cung cấp hệ thống chấm điểm và kết thúc vòng chơi.
- Hỗ trợ chế độ demo offline khi Gemini API không khả dụng.

## 3. Cấu trúc dự án
- src/server.js: điểm khởi chạy server Express và Socket.io.
- src/public/: giao diện người dùng bằng HTML, CSS và JavaScript.
- src/services/socketHandler.js: xử lý logic phòng chơi, socket events và vòng chơi.
- src/services/geminiService.js: tích hợp Gemini API để sinh dữ liệu trò chơi và kiểm tra câu trả lời.
- src/schemas/gameSchemas.js: xác thực cấu trúc dữ liệu từ AI.
- src/data/offline_questions.json: dữ liệu dự phòng cho chế độ demo.

## 4. Luồng hoạt động chính
1. Người chơi tạo phòng hoặc tham gia phòng qua mã phòng.
2. Khi đủ hai người chơi, hệ thống khởi tạo trò chơi.
3. Server tạo câu trả lời và các gợi ý từ Gemini hoặc dữ liệu offline.
4. Người chơi nhận gợi ý theo thời gian và có thể bấm buzzer để trả lời.
5. Hệ thống kiểm tra câu trả lời và cập nhật điểm số.

## 5. Tình trạng hiện tại
- Đã có giao diện trò chơi cơ bản.
- Đã có server realtime bằng Socket.io.
- Đã tích hợp Gemini API và fallback offline.
- Đã hỗ trợ phòng chơi 2 người và luồng vòng chơi cơ bản.

## 6. Kế hoạch phát triển tiếp theo
### Giai đoạn 1: Hoàn thiện trải nghiệm người dùng
- Cải thiện giao diện lobby và màn hình kết quả.
- Thêm thông báo rõ ràng hơn cho trạng thái phòng và lỗi.
- Tối ưu hiệu ứng timer và feedback.

### Giai đoạn 2: Nâng cao logic trò chơi
- Thêm chế độ nhiều vòng chơi liên tiếp.
- Cho phép người chơi chơi lại mà không cần reload trang.
- Cải thiện hệ thống chấm điểm và luật thắng thua.

### Giai đoạn 3: Tăng cường độ ổn định
- Bổ sung logging và error handling tốt hơn.
- Tối ưu cache cho Gemini API.
- Tăng khả năng phục hồi khi API lỗi hoặc mạng chậm.

### Giai đoạn 4: Mở rộng tính năng
- Hỗ trợ nhiều người chơi hơn trong một phòng.
- Thêm danh mục trò chơi phong phú hơn.
- Có thể lưu lịch sử trận đấu hoặc thống kê người chơi.

## 7. Các bước triển khai ưu tiên
1. Xác nhận luồng chơi hiện tại chạy ổn trên môi trường local.
2. Cải thiện giao diện và trải nghiệm người dùng.
3. Thêm tính năng chơi lại và vòng mới.
4. Tối ưu hiệu năng và độ ổn định.

## 8. Kết luận
Dự án này có nền tảng khá đầy đủ cho một trò chơi AI multiplayer đơn giản, có thể phát triển thành sản phẩm demo hấp dẫn và mở rộng thêm nhiều tính năng trong tương lai.
