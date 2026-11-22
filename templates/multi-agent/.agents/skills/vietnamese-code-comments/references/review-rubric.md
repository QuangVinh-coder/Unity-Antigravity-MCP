# Rubric review comment: đúng trước, tự nhiên sau

Dùng khi nhận yêu cầu “review comment”, khi nghi comment không khớp code hoặc khi đánh giá executor theo G7/G9.

## Thứ tự xem xét

1. **Đúng thực tế (bắt buộc):** Kiểm tra implementation, caller, base/override, điều kiện ném lỗi. Comment có nói đến rollback, atomic, thread-safety, authority, lưu dữ liệu mà code không làm không?
2. **Có giá trị:** Một người đọc có học thêm ràng buộc, lý do, rủi ro, thuật toán hoặc trường hợp biên không? Hay chỉ tả lại cú pháp?
3. **Dễ hiểu:** Người chưa giỏi C# có hiểu *ai*, *làm gì*, *vì sao* và *nếu bỏ thì sao* không? Có từ ngữ trừu tượng thay được bằng tình huống cụ thể?
4. **Đúng vị trí, vừa đủ:** Đoạn đơn giản được để yên? Comment đặt cạnh điểm rủi ro? `summary` nói hợp đồng, không kể diễn tiến trong thân hàm?
5. **An toàn phạm vi:** Có vô tình xóa chỉ thị tool, license hay comment mang dữ liệu máy đọc? Có lấn sang code/scene/prefab ngoài SCOPE không?

Không cho điểm bằng % số dòng comment, số method có `summary` hoặc mật độ dòng comment. Không có một số “tỷ lệ đẹp” cho mọi file.

## Phân loại phản hồi

- **Sai hoặc nguy hiểm:** Comment diễn đạt trái code hoặc khiến người sửa hiểu sai tính an toàn, side effect, thứ tự, ngoại lệ. Ghi `file:line`, nguồn chứng minh và hậu quả; phân mức theo `code-audit.md`, không tự bịa severity.
- **Thiếu giải thích quan trọng:** Một ràng buộc hoặc bước thuật toán không hiển nhiên cần ghi lại vì có khả năng bị sửa hỏng. Chỉ rõ nơi đặt và kiến thức còn thiếu.
- **Rườm rà/AI:** Câu đúng nhưng hành chính, mơ hồ, chỉ kể lại code. Đây thường là cải thiện chất lượng; đề xuất xóa hoặc thay 1–2 câu, không tự xem là lỗi Critical.
- **Không cần sửa:** Comment ngắn hoặc vắng comment nhưng source đã dễ hiểu. Không ép viết thêm để đủ mẫu.

## Khuôn nhận xét khi cần (trong báo cáo, không đặt vào source)

```text
File: <đường dẫn>:<dòng>
Vấn đề: <comment nói gì và vì sao chưa ổn>
Bằng chứng: <caller/logic/điều kiện cụ thể>
Đề xuất: <xóa comment hoặc 1-2 câu thay thế>
Mức độ: <theo code-audit.md, nếu là finding>
```

## Kiểm tra trước khi yêu cầu người khác sửa

- Đọc toàn method và ít nhất caller trực tiếp nếu câu mô tả thứ tự giao dịch.
- Đối chiếu exception với hành vi tiếp theo: ném trước `SpendGold` thì bước trừ tiền không chạy **trong call path đó**, nhưng không tự suy ra rollback toàn bộ.
- Phân biệt `HasSpaceFor()` đọc trước và `TryAddItems()` thay đổi kho: thiếu lock thì không tự nhận là an toàn khi có concurrency.
- Nếu scanner báo thiếu summary/comment theo chuẩn cũ, giữ bằng chứng scanner và nêu xung đột chính sách; không sửa code cho khớp số lượng rồi nhận PASS.
