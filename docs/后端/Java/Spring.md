# Spring 知识总结

> 主线：Spring 解决什么问题 → IoC/DI（核心）→ Bean 生命周期 → 循环依赖（重点）→ AOP → 事务 → MVC 流程 → Boot 自动配置。
> 风格沿用系列文档：先类比建直觉，术语给中英文 + 说明。

---

## 一、Spring 解决什么问题

没有 Spring 时，对象之间靠自己 `new`：`OrderService` 里 `new PaymentService()`、`new StockService()`……问题是**对象之间硬耦合、依赖关系乱成一团**：
- 想换实现（如把 `PaymentServiceImpl` 换成另一个），得改所有 `new` 它的地方；
- 对象的创建、依赖装配、生命周期全散落在业务代码里，没人统一管；
- 单元测试难（依赖是写死 new 的，没法替换成 mock）。

**Spring 的核心思想是 IoC（控制反转）**：**把"创建对象、管理对象之间的依赖"这件事，从你手里交给一个容器去做。** 你不再自己 `new`，而是告诉容器"我需要一个 PaymentService"，容器帮你造好、装配好、送上门。

**类比**：以前是你自己买菜做饭（自己 new、自己装配依赖）；现在是**餐厅**（Spring 容器）——你只管说要吃什么（声明依赖），厨房把菜做好、配好料端上来（容器创建并注入依赖）。你和"怎么做、谁来做"解耦了。

Spring 还在 IoC 之上提供了 **AOP（切面）、事务、MVC、与各种中间件的整合**等一整套能力，成了 Java 后端的事实标准框架。

---

## 二、IoC 与 DI（核心）

**IoC（Inversion of Control，控制反转）** 是**思想**：对象的创建和依赖管理的"控制权"，从程序员**反转**给了容器。
**DI（Dependency Injection，依赖注入）** 是**实现 IoC 的手段**：容器在创建对象时，**主动把它需要的依赖"注入"进去**。两者常一起说——IoC 是目标，DI 是做法。

**Spring 容器**：存放和管理所有对象（Spring 里叫 **Bean**）的地方。两个层次：
- **`BeanFactory`**：最基础的容器接口，提供 Bean 的获取，**懒加载**（用到才创建）。
- **`ApplicationContext`**：`BeanFactory` 的增强，**实际开发都用它**——额外支持：启动时**预加载**单例 Bean、国际化、事件发布、注解扫描等。

**三种注入方式**：
- **构造器注入（推荐）**：依赖通过构造方法传入。好处：① 依赖**不可变**（可声明 final）；② 保证对象创建时依赖就**齐全、非空**；③ 便于测试。Spring 官方推荐。
- **Setter 注入**：通过 setter 方法注入，适合**可选依赖**。
- **字段注入（`@Autowired` 直接标字段）**：最简洁但**不推荐**——依赖隐藏、不能 final、脱离容器没法注入（测试难）。

**怎么让容器知道有哪些 Bean**：`@Component`/`@Service`/`@Repository`/`@Controller`（标记类，配合 `@ComponentScan` 扫描）、`@Configuration` + `@Bean`（JavaConfig 方式，常用于配置第三方类）、以及老的 XML 方式。

---

## 三、Bean 的生命周期

一个 Bean 从生到死，Spring 管全程。主干流程（**记住四大步 + 几个扩展点**）：

```
① 实例化（Instantiation）：调构造方法 new 出对象（此时属性还是空的）
② 属性填充（Populate）：把依赖注入进去（@Autowired 在这一步生效）—— 循环依赖发生在这里
③ 初始化（Initialization）：
     · 各种 Aware 回调（如 BeanNameAware：告诉 Bean 它自己的名字、ApplicationContextAware：把容器给它）
     · BeanPostProcessor 的"前置处理" postProcessBeforeInitialization
     · 初始化方法（@PostConstruct → InitializingBean.afterPropertiesSet → 自定义 init-method）
     · BeanPostProcessor 的"后置处理" postProcessAfterInitialization ←★ AOP 代理在这一步生成
④ 使用（Bean 就绪，被业务调用）
⑤ 销毁（Destruction）：容器关闭时，@PreDestroy → DisposableBean.destroy → 自定义 destroy-method
```

**两个最重要的扩展点**：
- **`BeanPostProcessor`（后置处理器）**：在每个 Bean 初始化**前后**插入逻辑。**Spring 很多功能靠它实现**——比如 **AOP 代理就是在 `postProcessAfterInitialization` 里，把原始 Bean 包装成代理对象**返回。
- **`Aware` 接口**：让 Bean 能拿到容器的一些基础设施（自己的 beanName、ApplicationContext 等）。

（区分一个易混点：`BeanFactoryPostProcessor` 是处理 **Bean 定义（BeanDefinition）** 的，在 Bean 实例化之前、可修改配置元信息；`BeanPostProcessor` 是处理 **Bean 实例**的。）

---

## 四、循环依赖与三级缓存（重点）

**什么是循环依赖**：A 依赖 B、B 又依赖 A（`A → B → A`）。如果不处理，创建 A 要先有 B、创建 B 又要先有 A，死循环。

**Spring 能解决循环依赖，靠"三级缓存"**（前提：**单例 + setter/字段注入**）。三级缓存是三个 Map：
- **一级缓存 `singletonObjects`**：放**完整的成品** Bean（创建好、可直接用的）。
- **二级缓存 `earlySingletonObjects`**：放**半成品** Bean（已实例化、但还没填充完属性/没初始化的"早期引用"）。
- **三级缓存 `singletonFactories`**：放**对象工厂 `ObjectFactory`**（能按需产出早期 Bean 引用，关键用于 AOP 代理）。

**解决流程**（以 A、B 互相依赖为例）：
1. 创建 A → **实例化** A（半成品，属性还空）→ 把"A 的工厂"放进**三级缓存**；
2. 给 A **填充属性**，发现需要 B → 去创建 B；
3. 实例化 B → 把"B 的工厂"放进三级缓存 → 给 B 填充属性，发现需要 A；
4. **从三级缓存拿到 A 的工厂、产出 A 的早期引用，放入二级缓存**（删掉三级里 A 的工厂）→ B 拿到这个 A 的引用，**B 填充完成、初始化完成 → 放入一级缓存**；
5. 回到 A：A 拿到完整的 B，**A 填充完成、初始化完成 → 放入一级缓存**。
循环解开。

**为什么要三级缓存，二级不行吗？（高频深挖）** 关键在 **AOP**。如果 A 需要被代理（有切面/事务），那么提前曝光给 B 的必须是 **A 的代理对象**、而不是原始对象（否则 B 持有原始 A、和容器里最终的代理 A 不是同一个，事务/切面对 B 调 A 全失效）。

理解的关键：**三级缓存里放的不是对象，而是一个"工厂"——本质是一段延迟执行的逻辑 `getEarlyBeanReference`**，它干的事是"这个 Bean 需要代理就现在生成代理、不需要就返回原始对象"。这段逻辑**平时不执行**：
- **没有循环依赖时**：没人中途来要 A 的引用，工厂**不被调用**，A 的代理按**正常时机**（初始化的后置处理器）生成，工厂最后被丢弃。
- **发生循环依赖时**：B 来要 A，触发这个工厂，**把 A 的代理"提前"造出来**（本来该在 A 初始化最后才造）放进二级缓存给 B。等 A 自己初始化走到"造代理"那步，发现已经提前造过了，就**复用那个早期代理、不造第二个**——保证全场只有一个代理 A。

所以三级（工厂）比二级（直接放对象）强在：它把"**要不要生成代理、什么时候生成**"这个决定**延迟到真正需要时**——平时代理按正常时机生成，只有循环依赖逼它提前。二级缓存直接放现成对象，做不到这个"按需、延迟"的决定。
类比：A 是栋要精装修（代理）的房子，三级缓存放的不是半成品房子，而是一张"**装修队电话（工厂）**"——没人催就按正常节奏盖完再装修（电话白留），B 着急要地址就打电话让装修队**提前来装修**、再把装好的房子交给 B。

**为什么构造器注入的循环依赖解决不了？** 三级缓存能work，前提是"**先实例化、再填充属性**"——实例化后就能把半成品提前曝光。而**构造器注入要在实例化（调构造方法）的那一刻就拿到依赖**，对象都还没造出来、没法提前曝光，所以无解（Spring 会直接抛异常）。这也是"构造器注入更安全"的另一面：它把循环依赖这种坏味道**在启动时就暴露出来**。

---

## 五、AOP（面向切面编程）

**解决什么问题**：日志、事务、权限、监控这些逻辑，会**散落在大量方法里重复出现**（每个方法开头记日志、开事务……）。AOP 把这些**横切关注点（Cross-Cutting Concern）**抽出来，**集中定义、统一织入**，业务代码里干干净净。
类比：不去每个房间单独装监控/消防，而是**在整层楼统一布设**——业务方法不用自己写日志/事务，由切面统一"插入"。

**核心概念**（一句话一个）：
- **切面（Aspect）**：横切逻辑的载体（一个加日志的类）。
- **连接点（Join Point）**：可以被插入的点（方法执行）。
- **切点（Pointcut）**：用表达式**筛选**"要在哪些连接点插入"（如"所有 service 包下的方法"）。
- **通知（Advice）**：插入的具体逻辑 + 时机——`@Before`（前）、`@After`（后）、`@AfterReturning`（正常返回后）、`@AfterThrowing`（抛异常后）、`@Around`（环绕，最强，能控制是否执行目标方法）。
- **织入（Weaving）**：把切面逻辑"织"进目标方法的过程。Spring AOP 是**运行时**用**动态代理**织入。

**实现原理：动态代理**。Spring 不改你的原始类，而是**生成一个代理对象**替你的 Bean 干活，在调用目标方法前后插入通知逻辑。两种代理：
- **JDK 动态代理**：要求目标类**实现了接口**，代理对象实现同样的接口。基于反射。
- **CGLIB**：目标类**没有接口**时用，通过**生成目标类的子类**来代理（所以目标类/方法不能是 final）。
- **Spring 的选择**：默认情况下，**有接口用 JDK 代理、没接口用 CGLIB**（Spring Boot 2.x 起默认全用 CGLIB，避免一些接口相关的坑）。
类比：代理像**明星的经纪人**——粉丝（调用方）找明星（目标对象）都先经过经纪人，经纪人帮忙挡在前面安排（前置/后置逻辑），明星只管表演（核心业务）。

**AOP 失效的经典场景——自调用**：同一个类里，方法 A 调用方法 B（`this.B()`），就算 B 上有切面（如 `@Transactional`），**也不会生效**。因为 AOP 是通过**代理对象**调用才会触发切面，而 `this.B()` 是对象**内部直接调用、绕过了代理**。解决：注入自己的代理（`((XxxService)AopContext.currentProxy()).B()`）、或把 B 拆到另一个 Bean 里。

---

## 六、Spring 事务

**声明式事务（`@Transactional`）的本质就是 AOP**：在方法前开启事务、方法正常返回后提交、抛异常后回滚——这套"环绕逻辑"由事务切面统一织入，所以你只需在方法上加个注解。

**事务传播行为（Propagation）**：当一个**有事务的方法调用另一个有事务的方法**时，事务该怎么"传"。7 种，重点记 3 个：
- **`REQUIRED`（默认）**：当前有事务就**加入**，没有就**新建**。最常用。——A、B 在**同一个事务**里，B 回滚 A 也回滚。
- **`REQUIRES_NEW`**：**总是新建一个独立事务**，把外层事务挂起。——B 有自己独立的事务，B 提交/回滚不影响 A，A 回滚也不影响已提交的 B。适合"记日志"这种即使主流程失败也要保留的操作。
- **`NESTED`**：在当前事务里开一个**嵌套（savepoint 保存点）**，B 回滚只回滚到保存点、不连累 A，但 A 回滚会连 B 一起回。
- 其他：`SUPPORTS`（有就用、没有就非事务跑）、`NOT_SUPPORTED`、`MANDATORY`、`NEVER`。
类比 REQUIRED vs REQUIRES_NEW：REQUIRED 是"**跟你拼一桌**，一荣俱荣一损俱损"；REQUIRES_NEW 是"**我自己单开一桌**，互不影响"。

**事务失效的常见场景（高频）**：
1. **自调用**：同类里 `this.method()` 调用带 `@Transactional` 的方法——绕过代理，失效（同 AOP 失效，最常见）。
2. **方法非 public**：`@Transactional` 默认只对 public 方法生效。
3. **异常被自己 catch 了**：方法里 try-catch 把异常吞了、没抛出来，事务感知不到异常，不会回滚。
4. **抛的是检查异常**：`@Transactional` **默认只回滚 `RuntimeException` 和 `Error`**，受检异常（如 IOException）默认**不回滚**——要回滚得配 `@Transactional(rollbackFor = Exception.class)`。
5. **数据库引擎不支持事务**（如 MyISAM）、或方法所在类没被 Spring 管理。
6. **多线程**：事务靠 ThreadLocal 绑定连接，新开线程里的操作不在原事务内。

---

## 七、Spring MVC 请求处理流程

一个请求进来怎么走（**DispatcherServlet 是总调度**）：
```
请求 → ① DispatcherServlet（前端控制器，统一入口）
     → ② HandlerMapping：根据 URL 找到对应的处理器（哪个 Controller 的哪个方法）
     → ③ HandlerAdapter：适配并调用该处理器方法
     → ④ Controller 执行业务，返回 ModelAndView（或数据）
     → ⑤ ViewResolver：解析视图（如果是返回页面）
     → ⑥ 渲染视图 / 或 @ResponseBody 直接把对象转 JSON 写回响应
     → 返回给客户端
```
关键角色：**DispatcherServlet**（中央调度）、**HandlerMapping**（找处理器）、**HandlerAdapter**（调处理器）、**ViewResolver**（解析视图）。前后端分离项目里多用 `@RestController`/`@ResponseBody`，跳过视图解析、直接返回 JSON。

---

## 八、Spring Boot 自动配置

Spring Boot 的核心价值：**约定大于配置**——以前用 Spring 要写一堆 XML/配置，Boot 帮你**自动配置**好大部分。

**`@SpringBootApplication` 拆解**（启动类上那个注解）= 三个注解合体：
- `@SpringBootConfiguration`：标记这是配置类（本质是 `@Configuration`）。
- `@ComponentScan`：扫描启动类所在包及子包下的组件（所以 Bean 要放在启动类同级或下级包）。
- **`@EnableAutoConfiguration`**：**自动配置的开关**，最核心。

**自动配置原理**（高频）：
1. `@EnableAutoConfiguration` 通过 `@Import` 导入一个选择器 `AutoConfigurationImportSelector`。
2. 这个选择器去读 **`META-INF/spring.factories`**（Spring Boot 2.x）或 **`META-INF/spring/...AutoConfiguration.imports`**（2.7+/3.x）文件，里面列了**一大堆自动配置类**（如 `DataSourceAutoConfiguration`、`RedisAutoConfiguration`）——这本质是一种 **SPI（服务发现）机制**。
3. 这些配置类不是无脑全部生效，而是带 **`@Conditional` 条件注解**：`@ConditionalOnClass`（classpath 里有某个类才配，比如引了 redis 依赖才配 Redis）、`@ConditionalOnMissingBean`（你没自己定义才用默认的，给你覆盖的机会）等。**满足条件的才装配**。
一句话：**Boot 启动时扫描所有 jar 里登记的自动配置类，按"你引了什么依赖、有没有自己配"这些条件，自动帮你装好需要的 Bean。**

**Starter（起步依赖）**：`spring-boot-starter-web` 这种，是**一组相关依赖的聚合包**——引一个 starter 就把一类功能要用的依赖全带进来了，配合上面的自动配置，做到"引入即可用"。

---

## 九、Spring 里的设计模式（了解，面试常问）

- **工厂模式**：BeanFactory / ApplicationContext 就是用工厂模式创建 Bean。
- **单例模式**：Spring Bean 默认单例（容器里一个类型一个实例）。
- **代理模式**：AOP 用动态代理。
- **模板方法模式**：`JdbcTemplate`、`RestTemplate`——把固定流程写好、把可变部分留给你填。
- **观察者模式**：Spring 的事件机制（`ApplicationEvent` + 监听器）。
- **适配器模式**：Spring MVC 的 `HandlerAdapter`（适配不同类型的处理器）。
- **装饰器模式**：包装类（如各种 `BeanWrapper`）。

---

## 十、面试快问快答清单

1. IoC / DI？→ IoC 是思想(对象创建权交给容器)，DI 是手段(容器主动把依赖注入进来)。
2. BeanFactory vs ApplicationContext？→ 前者基础、懒加载；后者增强、预加载单例 + 国际化/事件/注解，实际都用它。
3. 三种注入方式、推荐哪个？→ 构造器(推荐，可 final、依赖齐全、好测试)、setter、字段(不推荐)。
4. Bean 生命周期？→ 实例化 → 属性填充 → 初始化(Aware → BeanPostProcessor前 → init方法 → BeanPostProcessor后) → 使用 → 销毁。
5. BeanPostProcessor 干嘛？→ Bean 初始化前后插逻辑，AOP 代理就在它的后置处理里生成。
6. 循环依赖怎么解决？→ 三级缓存：一级成品、二级半成品、三级对象工厂(产早期引用/代理)。
7. 为什么要三级缓存？→ 为兼容 AOP：发生循环依赖时用工厂临时生成代理提前曝光；二级放现成对象无法延迟决定是否代理。
8. 构造器注入为什么解决不了循环依赖？→ 实例化时就要拿依赖，对象还没造出来、没法提前曝光。
9. Bean 作用域？→ singleton(默认)、prototype(每次新建)、request、session。
10. AOP 是什么？→ 把日志/事务等横切关注点抽出来统一织入，靠动态代理实现。
11. JDK 代理 vs CGLIB？→ 有接口用 JDK(实现接口)、无接口用 CGLIB(生成子类，类/方法不能 final)；Boot 2.x 起默认 CGLIB。
12. AOP/事务为什么自调用失效？→ this.method() 走的是原始对象、绕过了代理，切面不触发。
13. @Transactional 失效场景？→ 自调用、非 public、异常被 catch、抛检查异常(默认不回滚要 rollbackFor)、多线程。
14. 事务传播 REQUIRED vs REQUIRES_NEW？→ 前者加入当前事务(一损俱损)；后者总新建独立事务(互不影响)。
15. Spring MVC 流程？→ DispatcherServlet → HandlerMapping 找处理器 → HandlerAdapter 调 → Controller → ViewResolver/或 JSON 返回。
16. Spring Boot 自动配置原理？→ @EnableAutoConfiguration 导入选择器，读 spring.factories/.imports 里的自动配置类(SPI)，按 @Conditional 条件按需装配。
17. @SpringBootApplication 包含什么？→ @SpringBootConfiguration + @ComponentScan + @EnableAutoConfiguration。
