---
name: vietnamese-code-comments
description: Viết, sửa và review comment/XML documentation tiếng Việt tự nhiên trong Unity C#. Dùng khi tạo/sửa file .cs, thay đổi hợp đồng API, thuật toán, coroutine, Job System, networking, FSM hoặc khi người dùng chê comment quá giống AI. Ưu tiên giải thích ràng buộc và hậu quả thật, không kể lại từng dòng code.
---

# Vietnamese Code Comments — Unity/C#

## Mục tiêu và nguồn quy tắc

Viết comment như một lập trình viên Việt Nam đang giải thích cho đồng nghiệp: **cụ thể, đúng với code, ngắn khi đơn giản và sâu khi khó**. Không cố lấp chỗ trống bằng `summary` dài hoặc comment cho đủ mọi `if`.

Khi làm trong repository này, áp dụng trước:

1. `.agents/rules/vietnamese-comment-standard.md` (**VCS-01..10**, canonical cho cách comment).
2. `.agents/rules/coding-convention.md` (UCC-01..37; đặc biệt UCC-02, 08, 09, 20, 31..36).
3. Phạm vi task/owner approval, `AGENTS.md`, hướng dẫn an toàn của repo; **skill không cấp quyền sửa file ngoài SCOPE**.

Nếu gặp quy tắc cũ yêu cầu comment mọi method/điều kiện, báo xung đột và ưu tiên chính sách VCS mới **khi bản VCS mới đã được owner áp dụng**. Không tự sửa scanner hay tuyên bố đã đồng bộ validator khi chưa kiểm tra.

## Khi nào sử dụng

- Mọi task **tạo hoặc sửa comment** trong C#, kể cả comment phát sinh khi sửa gameplay.
- Review code có comment dài, chung chung, sai hợp đồng, sai thời điểm Unity hoặc nghe máy móc.
- Phân tích đoạn thuật toán khó để quyết định cần thêm comment tại đâu.
- Điều chỉnh XML summary/Tooltip mà vẫn giữ nguyên API và định dạng do tool sử dụng.

**Không dùng** để tự ý refactor gameplay, đặt lại tên cả repo, xóa bình luận license, đổi directive analyzer, hoặc chỉnh code khi user chỉ nhờ sửa ngôn ngữ comment.

## Quy trình bắt buộc

### 1. Đọc đúng ngữ cảnh trước khi viết

- Mở **toàn bộ method** đang sửa, method base/override và caller quan trọng. Với nghiệp vụ, tìm vị trí kiểm tra đầu vào, thay đổi state, ném lỗi và commit kết quả.
- Khi gặp `TryAddItems()`, `SpendGold()`, `Deliver()`, `JobHandle.Complete()`, callback hoặc luồng networking: xác nhận caller gọi theo **thứ tự thật**; không suy ra từ tên method.
- Kiểm tra comment cũ có phải directive dành cho compiler/analyzer, marker generated hoặc license. Nếu có hoặc không chắc, **giữ nguyên**.
- Chỉ comment điều có cơ sở từ source, tài liệu hiện có, kết quả test hoặc hợp đồng đã xác minh. Nếu không chắc: đọc thêm hoặc nêu thiếu dữ kiện trong báo cáo, **không bịa comment**.

### 2. Phân loại trước khi viết

| Mức                       | Ví dụ                                                                         | Hành động                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **0 — Tự giải thích**     | Getter, gán field, `if (x == null) return`, phép cộng dễ hiểu                 | Thường **không comment**. Nếu khó đọc, cân nhắc cải thiện tên/cấu trúc trong SCOPE.                             |
| **1 — Có hợp đồng**       | `TryPurchase`, `CanAfford`, `SpendGold`, giới hạn đầu vào                     | Một summary ngắn **nếu** người gọi cần biết điều kiện thất bại, side effect, exception, đơn vị hoặc thứ tự gọi. |
| **2 — Thuật toán/rủi ro** | Pathfinding, NativeContainer, FSM phức tạp, authority, retry, quy tắc xếp kho | Giải thích những bước không hiển nhiên, lý do, bất biến, edge case và hậu quả; ví dụ nhỏ nếu giúp hiểu.         |

Không áp quota ký tự, dòng hoặc số comment. Có đoạn 30 dòng không cần comment, có đoạn 5 dòng cần 2 câu để tránh bug.

### 3. Chọn thông tin “code chưa tự nói”

Chỉ giữ comment nếu bổ sung ít nhất một điều:

- **Lý do:** vì sao chọn cách này thay vì cách dễ đoán hơn.
- **Ràng buộc:** giới hạn của Unity, dữ liệu, caller hoặc luật gameplay.
- **Rủi ro/hậu quả:** điều gì hỏng khi bỏ guard hoặc đảo thứ tự.
- **Thuật toán:** ý nghĩa biến trung gian, vòng lặp khó, cách dừng, vì sao công thức đúng.
- **Nguồn đáng tin:** link tới issue, thiết kế, spec, quyết định owner khi cần (không bịa mã).

Không viết `// kiểm tra null`, `// lặp qua danh sách`, `// trả kết quả`, “public để gọi từ bên ngoài” hay các câu giải thích cú pháp C# cơ bản.

### 4. Viết tiếng Việt như lời giải thích thực tế

Mẫu tư duy **không phải mẫu bắt buộc đưa nguyên vào comment**:

> [Ai/cái gì] có thể gặp [tình huống cụ thể]. [Vì thế bước này làm gì / tránh hậu quả nào].

- Chủ thể cụ thể: kho, Gold, người chơi, ô đồ, state Death, job, server, client.
- Động từ gần cách nói thường: “thêm”, “dừng”, “chờ”, “giữ lại”, “trừ”, “bỏ qua”, “chỉ nhận”.
- Khi đã đủ rõ trong một câu, dừng ở một câu. Không ép comment thành ba nhãn “Mục đích/Lý do/Ví dụ”.
- Tránh cụm từ trừu tượng khi có thể nêu hành vi: “bảo đảm tính nhất quán”, “trong ngữ cảnh đồng bộ”, “xử lý vi phạm thứ tự”. Không cấm thuật ngữ chính xác; nếu phải dùng, gắn nó với tình huống.
- Mọi nhận định về `rollback`, `atomic transaction`, `thread-safety`, `authority`, `idempotency` phải có **cơ chế thật trong code**.
- Giữ nguyên identifier/API bằng tiếng Anh; comment diễn giải bằng tiếng Việt có dấu (VCS-01).

### 5. Chọn vị trí phù hợp

- `/// <summary>` cho **hợp đồng đối với người gọi**, không kể các bước bên trong.
- `//` trong thân method tại **điểm dễ hiểu nhầm**, trước giai đoạn thuật toán hoặc trước thao tác rủi ro; **một comment có thể bao phủ cả cụm**.
- `[Tooltip]` cho giá trị Inspector không thể đoán (sentinel, range, layer/reference bắt buộc), không dịch tên field.
- Nếu cần giải thích một thuật toán dài cho người học: giữ source gọn; viết **bản giải thích riêng trong báo cáo hoặc docs theo yêu cầu**. Không nhồi bài học hàng chục dòng vào mọi method.

### 6. Tự review trước khi hoàn thành

1. Comment có đúng hành vi source/caller không? Có hứa quá mức về lỗi, hoàn tác hoặc đồng bộ không?
2. Đọc riêng comment: người đọc có biết thêm **một điều cụ thể** mà tên và code không nói hết không? Nếu không, **xóa**.
3. Người mới có hiểu ai làm gì và nếu sai thì hậu quả là gì không?
4. Đã để yên những đoạn rõ nghĩa, không rải `summary`/comment đồng đều chưa?
5. Có xóa nhầm directive/tool comment, làm đổi code, scene, serialized reference hoặc file ngoài SCOPE không?
6. Với review: mỗi vấn đề phải có `file:line` và đề xuất hành động rõ; **không chấm FAIL vì thiếu comment ở `if` đơn giản**.

Khi user muốn ví dụ phong cách, đọc `references/comment-examples.md`. Khi review một diff hoặc đánh giá comment gây hiểu nhầm, đọc `references/review-rubric.md`. Khi task có Job/NativeContainer/FSM/networking, đọc `references/unity-high-risk.md`.

## Đầu ra mong đợi

- Nếu task chỉ sửa comment: diff **chỉ comment/documentation** theo phạm vi đã cho. Nếu phát hiện lỗi logic, ghi finding riêng; không tự sửa khi chưa được yêu cầu.
- Nếu task viết code: comment đúng chỗ, không dày theo mẫu. Báo cáo ngắn nếu có rủi ro hoặc giả định quan trọng; không thêm phần “giải thích cú pháp” vào từng method.
- Nếu task review: chỉ ra comment sai/rườm rà/thiếu thông tin quan trọng, nêu **vì sao** và **đề xuất câu thay thế tự nhiên**, phân biệt vấn đề văn phong với lỗi chức năng.
- Không nói đã chạy test, scanner hay Unity Editor nếu chưa thực sự chạy.

## Gameplay-first Explanation

Khi viết comment cho Unity/C#, hãy giải thích như một
lập trình viên đang hướng dẫn đồng nghiệp hiểu cơ chế game.

### Quy trình

1. Đọc method và những caller/callee cần thiết để hiểu
   hành vi thực tế, không suy đoán từ tên hàm.

2. Xác định đoạn code đang giải quyết vấn đề gì
   trong gameplay hoặc hệ thống.

3. Diễn đạt bằng ngôn ngữ tự nhiên:
   - Đối tượng nào đang được xử lý?
   - Hệ thống kiểm tra hoặc thay đổi điều gì?
   - Vì sao bước xử lý này quan trọng?

4. Chỉ bổ sung giải thích kỹ thuật khi cần:
   - Thuật toán không hiển nhiên.
   - Công thức hoặc điều kiện dừng khó hiểu.
   - Tràn số, race condition, đồng bộ dữ liệu.
   - Các trường hợp biên có thể gây lỗi.

5. Đọc lại comment như lời giải thích cho đồng nghiệp.
   Nếu câu văn quá trừu tượng, hãy thay bằng đối tượng
   và hành vi cụ thể.

### Ví dụ: Inventory stacking

KHÔNG NÊN:
// Ô cuối có thể thừa chỗ: cần 12 món,
// hai ô còn 3 và 10 chỗ thì còn 12 → 9 → -1.

NÊN:
// Chỉ cần các ô trong kho có tổng chỗ trống đủ
// chứa số vật phẩm muốn thêm, không cần vừa khít.

### Nguyên tắc quan trọng

- Gameplay-first không có nghĩa là bỏ qua kỹ thuật.
- Không biến comment thành tài liệu hướng dẫn chơi game.
- Không giải thích lại các câu lệnh hiển nhiên.
- Không thêm ví dụ Minecraft nếu dự án không có
  cơ chế tương ứng.
- Với networking, database, persistence hoặc thuật toán
  không trực tiếp liên quan gameplay, ưu tiên giải thích
  hành vi hệ thống thay vì cố gắn vào gameplay.
- Nếu logic phức tạp cần nhiều kiến thức nền, chỉ giữ
  comment phục vụ bảo trì trong source code; giải thích
  chuyên sâu ở tài liệu riêng.

## Câu hỏi kiểm tra cuối cùng

> Nếu một developer sửa đoạn này sau ba tháng, comment có giúp họ **không vô tình phá một điều quan trọng** không?
>
> Nếu không, comment có thể không cần tồn tại.
