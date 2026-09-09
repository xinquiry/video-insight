fn main() {
    // button 固件的 device_id 在烧录时经 DEVICE_ID 环境变量注入；
    // 值变化时必须重编译，否则会沿用旧编码。
    println!("cargo:rerun-if-env-changed=DEVICE_ID");
    embuild::espidf::sysenv::output();
}
