# Các vùng Unity/C# cần giải thích sâu khi không tự hiển nhiên

Đây là **câu hỏi kiểm tra**, không phải danh sách buộc thêm comment ở mỗi dòng. Mọi câu trả lời phải dựa trên code hiện tại và quy tắc repo.

## Lifecycle và event

- Ai tạo/giữ component? Khi `Awake`, `OnEnable`, `Start` xảy ra, reference đã được cấu hình chưa?
- Khi đăng ký `event`, có hủy đăng ký tại thời điểm thích hợp? Có lý do đặc biệt nếu dùng `OnDestroy` thay `OnDisable`?
- Cần tránh lặp handler, callback sau khi object bị disable/destroy hoặc thứ tự tạo object không bảo đảm?

## Coroutine / async

- Ai dừng coroutine khi scene đổi, component bị disable hay object destroy?
- Task/callback có thể chạy sau khi màn hình đóng không? Có cancellation hoặc kiểm tra owner hợp lệ không?
- Thời điểm áp dụng trạng thái có phụ thuộc frame/FixedUpdate không? Chỉ giải thích điểm không hiển nhiên.

## Unity Jobs / NativeCollection

- JobHandle đã `Complete()` trước khi CPU sửa/đọc buffer thuộc job chưa?
- `NativeArray`/`NativeList`/`NativeHashMap` có được `Dispose()` ở mọi nhánh không, kể cả lỗi?
- Container có bị dispose quá sớm hoặc đồng thời với job? Comment nên nói **dữ liệu nào có thể còn bị job truy cập**, không chỉ “đảm bảo an toàn”.

## Gameplay/FSM/Stat

- State nào ưu tiên? Có guard khiến Death không chuyển về Hit?
- Thứ tự damage/armor/crit/clamp có làm thay đổi kết quả không?
- Công thức có đơn vị/hệ số/rounding khác trực giác không? Đưa ví dụ tính bằng dữ liệu thật nếu giúp hiểu.
- Việc đếm item dựa trên *số lượt mua* hay *số món nhận*? Có giới hạn `int`/`long` không?

## Serialization / ScriptableObject

- Di chuyển file MonoBehaviour/ScriptableObject có làm mất binding `m_Script`/GUID không (UCC-28)?
- Đổi serialized field có cần `FormerlySerializedAs` không? Đừng coi compile thành công là bằng chứng prefab còn binding.
- Tooltip nào thực sự cần cho sentinel hoặc dependency Inspector?

## Networking / dedicated server / database

- Ai có authority chỉnh Gold, HP, inventory? Có xác thực input từ client ở server không?
- Một request gửi lại có bị xử lý hai lần không? Có `requestId` + trạng thái đã xử lý thật không?
- Nếu thất bại giữa hai bước cập nhật, dữ liệu có được rollback/compensate không? Nếu không, **không được hứa có**.
- Race condition giữa bước kiểm và bước ghi có thể xuất hiện nếu callback/await chen vào không?
- Có timeout/retry? Timeout là không nhận phản hồi, không nhất thiết là server chưa làm gì.

## Khi nào chuyển kiến thức ra docs

Nếu cần trình bày toàn bộ nguyên lý pathfinding, transaction, Job System, replication để owner học, nên viết tài liệu riêng **khi task cho phép**. Trong source chỉ giữ ràng buộc và bước dễ sửa hỏng; nếu cần tham chiếu tài liệu, dùng đường dẫn thật đã tồn tại.
